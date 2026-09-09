use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_shell::{
    process::{Command, CommandChild, CommandEvent},
    ShellExt,
};
use tokio::{sync::Mutex as AsyncMutex, time::Instant};

const PROTOCOL_VERSION: u8 = 1;
const MAX_PROTOCOL_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_RECENT_REQUEST_IDS: usize = 256;
const CANCELLATION_GRACE: Duration = Duration::from_secs(10);
const ENGINE_SHUTDOWN_GRACE: Duration = Duration::from_secs(3);
const EVENT_WAIT_POLL: Duration = Duration::from_millis(100);

struct EngineProcesses {
    registry: Mutex<ProcessRegistry>,
    request_lock: AsyncMutex<()>,
    next_cancel_id: AtomicU64,
}

impl Default for EngineProcesses {
    fn default() -> Self {
        Self {
            registry: Mutex::new(ProcessRegistry::default()),
            request_lock: AsyncMutex::new(()),
            next_cancel_id: AtomicU64::new(1),
        }
    }
}

#[derive(Default)]
struct ProcessRegistry {
    active: HashMap<String, Arc<ActiveEngine>>,
    starting: HashMap<String, bool>,
    pending_cancellations: VecDeque<String>,
    completed: VecDeque<String>,
}

impl ProcessRegistry {
    fn begin_request(&mut self, request_id: &str, cancellable: bool) -> Result<(), String> {
        if self.active.contains_key(request_id) || self.starting.contains_key(request_id) {
            return Err(format!(
                "Protocol request ID {request_id:?} has already been used."
            ));
        }
        if let Some(index) = self.completed.iter().position(|id| id == request_id) {
            self.completed.remove(index);
        }
        if !cancellable && self.remove_pending(request_id) {
            push_bounded(&mut self.completed, request_id.to_string());
            return Err("The engine request was interrupted before launch.".to_string());
        }
        self.starting.insert(request_id.to_string(), cancellable);
        Ok(())
    }

    fn register_active(
        &mut self,
        request_id: &str,
        engine: Arc<ActiveEngine>,
    ) -> Result<bool, String> {
        if self.starting.remove(request_id).is_none() {
            return Err(format!(
                "Protocol request ID {request_id:?} was not registered as starting."
            ));
        }
        if self.active.insert(request_id.to_string(), engine).is_some() {
            return Err(format!(
                "Protocol request ID {request_id:?} already has an active engine."
            ));
        }
        Ok(self.remove_pending(request_id))
    }

    fn interrupt(&mut self, request_id: &str) -> InterruptDisposition {
        if let Some(engine) = self.active.get(request_id) {
            return if engine.cancellable {
                InterruptDisposition::Active(Arc::clone(engine))
            } else {
                InterruptDisposition::Rejected
            };
        }
        if self.completed.iter().any(|id| id == request_id) {
            return InterruptDisposition::Rejected;
        }
        if self
            .starting
            .get(request_id)
            .is_some_and(|cancellable| !cancellable)
        {
            return InterruptDisposition::Rejected;
        }
        InterruptDisposition::Queued(self.queue_pending(request_id))
    }

    fn finish_request(&mut self, request_id: &str) {
        self.active.remove(request_id);
        self.starting.remove(request_id);
        self.remove_pending(request_id);
        if !self.completed.iter().any(|id| id == request_id) {
            push_bounded(&mut self.completed, request_id.to_string());
        }
    }

    fn queue_pending(&mut self, request_id: &str) -> bool {
        if self.pending_cancellations.iter().any(|id| id == request_id) {
            return false;
        }
        push_bounded(&mut self.pending_cancellations, request_id.to_string());
        true
    }

    fn remove_pending(&mut self, request_id: &str) -> bool {
        let Some(index) = self
            .pending_cancellations
            .iter()
            .position(|id| id == request_id)
        else {
            return false;
        };
        self.pending_cancellations.remove(index);
        true
    }
}

fn push_bounded(queue: &mut VecDeque<String>, value: String) {
    if queue.len() == MAX_RECENT_REQUEST_IDS {
        queue.pop_front();
    }
    queue.push_back(value);
}

enum InterruptDisposition {
    Active(Arc<ActiveEngine>),
    Queued(bool),
    Rejected,
}

struct ActiveEngine {
    cancellable: bool,
    child: Mutex<Option<CommandChild>>,
    cancellation: Mutex<CancellationState>,
    terminal_received: AtomicBool,
    process_tree: ProcessTreeGuard,
}

impl ActiveEngine {
    fn new(
        request_id: String,
        cancellable: bool,
        child: CommandChild,
        process_tree: ProcessTreeGuard,
    ) -> Self {
        Self {
            cancellable,
            child: Mutex::new(Some(child)),
            cancellation: Mutex::new(CancellationState {
                target_request_id: request_id,
                ..CancellationState::default()
            }),
            terminal_received: AtomicBool::new(false),
            process_tree,
        }
    }

    fn start_request(
        &self,
        request_line: &str,
        pending_cancel_request_id: Option<String>,
    ) -> Result<(), String> {
        let mut cancellation = self
            .cancellation
            .lock()
            .map_err(|_| "Engine cancellation state is unavailable.".to_string())?;
        if cancellation.request_started {
            return Err("The verification engine request was already started.".to_string());
        }
        if cancellation.request_id.is_none() {
            cancellation.request_id = pending_cancel_request_id;
        }

        let cancellation_line = cancellation
            .request_id
            .as_deref()
            .map(|cancel_request_id| {
                encode_cancellation_request(cancel_request_id, &cancellation.target_request_id)
            })
            .transpose()?;
        let mut payload = String::with_capacity(
            request_line.len()
                + cancellation_line
                    .as_ref()
                    .map_or(1, |line| line.len().saturating_add(2)),
        );
        payload.push_str(request_line);
        payload.push('\n');
        if let Some(line) = cancellation_line {
            payload.push_str(&line);
            payload.push('\n');
        }

        self.child
            .lock()
            .map_err(|_| "Engine stdin state is unavailable.".to_string())?
            .as_mut()
            .ok_or_else(|| "The verification engine stdin stream is already closed.".to_string())?
            .write(payload.as_bytes())
            .map_err(|error| format!("Could not send the protocol request: {error}"))?;
        cancellation.request_started = true;
        if cancellation.request_id.is_some() {
            cancellation.sent_at = Some(Instant::now());
        }
        Ok(())
    }

    fn send_cancellation(&self, cancel_request_id: String) -> Result<bool, String> {
        if !self.cancellable || self.terminal_received.load(Ordering::Acquire) {
            return Ok(false);
        }

        let mut cancellation = self
            .cancellation
            .lock()
            .map_err(|_| "Engine cancellation state is unavailable.".to_string())?;
        if cancellation.request_id.is_some() {
            return Ok(false);
        }
        if self.terminal_received.load(Ordering::Acquire) {
            return Ok(false);
        }

        if !cancellation.request_started {
            cancellation.request_id = Some(cancel_request_id);
            return Ok(true);
        }

        let line =
            encode_cancellation_request(&cancel_request_id, &cancellation.target_request_id)?;
        self.child
            .lock()
            .map_err(|_| "Engine stdin state is unavailable.".to_string())?
            .as_mut()
            .ok_or_else(|| "The verification engine stdin stream is already closed.".to_string())?
            .write(format!("{line}\n").as_bytes())
            .map_err(|error| format!("Could not send the cancellation request: {error}"))?;

        cancellation.request_id = Some(cancel_request_id);
        cancellation.sent_at = Some(Instant::now());
        Ok(true)
    }

    fn cancellation_request_id(&self) -> Result<Option<String>, String> {
        self.cancellation
            .lock()
            .map(|state| state.request_id.clone())
            .map_err(|_| "Engine cancellation state is unavailable.".to_string())
    }

    fn cancellation_deadline(&self) -> Result<Option<Instant>, String> {
        self.cancellation
            .lock()
            .map(|state| state.sent_at.map(|sent_at| sent_at + CANCELLATION_GRACE))
            .map_err(|_| "Engine cancellation state is unavailable.".to_string())
    }

    fn mark_terminal_and_close_stdin(&self) -> Result<(), String> {
        self.terminal_received.store(true, Ordering::Release);
        self.child
            .lock()
            .map_err(|_| "Engine stdin state is unavailable.".to_string())?
            .take();
        Ok(())
    }

    fn terminate_tree(&self) -> Result<(), String> {
        #[cfg(windows)]
        {
            self.process_tree.terminate()
        }

        #[cfg(not(windows))]
        {
            self.child
                .lock()
                .map_err(|_| "Engine process state is unavailable.".to_string())?
                .take()
                .map_or(Ok(()), |child| {
                    child.kill().map_err(|error| {
                        format!(
                            "Could not terminate engine process {}: {error}",
                            self.process_tree.process_id
                        )
                    })
                })
        }
    }
}

#[derive(Default)]
struct CancellationState {
    target_request_id: String,
    request_id: Option<String>,
    sent_at: Option<Instant>,
    request_started: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestIdentity {
    protocol_version: u8,
    id: String,
    method: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancellationRequest<'a> {
    protocol_version: u8,
    id: &'a str,
    method: &'static str,
    params: CancellationParams<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancellationParams<'a> {
    target_request_id: &'a str,
}

fn encode_cancellation_request(
    cancel_request_id: &str,
    target_request_id: &str,
) -> Result<String, String> {
    serde_json::to_string(&CancellationRequest {
        protocol_version: PROTOCOL_VERSION,
        id: cancel_request_id,
        method: "verification.cancel",
        params: CancellationParams { target_request_id },
    })
    .map_err(|error| format!("Could not encode the cancellation request: {error}"))
}

#[derive(Debug, PartialEq)]
enum RoutedMessage {
    Event(String),
    OriginalTerminal(String),
    CancellationAcknowledgement(bool),
}

fn route_protocol_message(
    line: &str,
    original_request_id: &str,
    cancellation_request_id: Option<&str>,
) -> Result<RoutedMessage, String> {
    let message: Value = serde_json::from_str(line)
        .map_err(|error| format!("Engine emitted invalid protocol JSON: {error}"))?;
    let object = message
        .as_object()
        .ok_or_else(|| "Engine emitted a non-object protocol message.".to_string())?;
    if object.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into()) {
        return Err("Engine emitted an unsupported protocol version.".to_string());
    }
    let message_id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "Engine emitted a protocol message without a request ID.".to_string())?;

    let is_event = object.contains_key("event");
    let is_result = object.contains_key("result");
    let is_error = object.contains_key("error");
    if usize::from(is_event) + usize::from(is_result) + usize::from(is_error) != 1 {
        return Err("Engine emitted an unknown protocol envelope.".to_string());
    }

    if is_event {
        if message_id != original_request_id {
            return Err(format!(
                "Engine emitted an event for unexpected request ID {message_id:?}."
            ));
        }
        return Ok(RoutedMessage::Event(line.to_string()));
    }
    if message_id == original_request_id {
        return Ok(RoutedMessage::OriginalTerminal(line.to_string()));
    }
    if cancellation_request_id == Some(message_id) {
        if is_error {
            return Err("Engine rejected the cancellation control request.".to_string());
        }
        let accepted = object
            .get("result")
            .and_then(Value::as_object)
            .and_then(|result| result.get("accepted"))
            .and_then(Value::as_bool)
            .ok_or_else(|| "Engine emitted an invalid cancellation acknowledgement.".to_string())?;
        return Ok(RoutedMessage::CancellationAcknowledgement(accepted));
    }

    Err(format!(
        "Engine emitted a terminal message for unexpected request ID {message_id:?}."
    ))
}

#[derive(Default)]
struct NdjsonBuffer {
    pending: Vec<u8>,
}

impl NdjsonBuffer {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
            let mut raw = self.pending.drain(..=newline).collect::<Vec<_>>();
            raw.pop();
            if raw.last() == Some(&b'\r') {
                raw.pop();
            }
            Self::assert_line_bounded(&raw)?;
            Self::decode_nonempty(raw, &mut lines)?;
        }
        self.assert_bounded()?;
        Ok(lines)
    }

    fn finish(&mut self) -> Result<Vec<String>, String> {
        let mut raw = std::mem::take(&mut self.pending);
        if raw.last() == Some(&b'\r') {
            raw.pop();
        }
        Self::assert_line_bounded(&raw)?;
        let mut lines = Vec::new();
        Self::decode_nonempty(raw, &mut lines)?;
        Ok(lines)
    }

    fn decode_nonempty(raw: Vec<u8>, lines: &mut Vec<String>) -> Result<(), String> {
        let line = String::from_utf8(raw)
            .map_err(|error| format!("Engine emitted non-UTF-8 protocol output: {error}"))?;
        if !line.trim().is_empty() {
            lines.push(line);
        }
        Ok(())
    }

    fn assert_bounded(&self) -> Result<(), String> {
        Self::assert_line_bounded(&self.pending)
    }

    fn assert_line_bounded(line: &[u8]) -> Result<(), String> {
        if line.len() > MAX_PROTOCOL_LINE_BYTES {
            return Err(format!(
                "Engine protocol line exceeds the {MAX_PROTOCOL_LINE_BYTES}-byte limit."
            ));
        }
        Ok(())
    }
}

enum EngineInvocation {
    Sidecar,
    #[cfg(debug_assertions)]
    DebugCommand {
        program: String,
        args: Vec<String>,
    },
}

fn engine_invocation() -> Result<EngineInvocation, String> {
    #[cfg(debug_assertions)]
    {
        debug_engine_invocation(
            std::env::var("VERIFY_ENGINE_COMMAND").ok(),
            std::env::var("VERIFY_ENGINE_ARGS_JSON").ok(),
        )
    }

    #[cfg(not(debug_assertions))]
    {
        Ok(EngineInvocation::Sidecar)
    }
}

#[cfg(debug_assertions)]
fn debug_engine_invocation(
    command: Option<String>,
    args_json: Option<String>,
) -> Result<EngineInvocation, String> {
    let Some(program) = command else {
        if args_json.is_some() {
            return Err(
                "VERIFY_ENGINE_ARGS_JSON requires VERIFY_ENGINE_COMMAND in debug builds."
                    .to_string(),
            );
        }
        return Ok(EngineInvocation::Sidecar);
    };
    if program.trim().is_empty() {
        return Err("VERIFY_ENGINE_COMMAND cannot be empty.".to_string());
    }
    let args = match args_json {
        Some(source) => serde_json::from_str::<Vec<String>>(&source)
            .map_err(|error| format!("VERIFY_ENGINE_ARGS_JSON is invalid: {error}"))?,
        None => Vec::new(),
    };
    Ok(EngineInvocation::DebugCommand { program, args })
}

fn engine_command(app: &AppHandle, invocation: EngineInvocation) -> Result<Command, String> {
    match invocation {
        EngineInvocation::Sidecar => app
            .shell()
            .sidecar("verify-engine")
            .map(|command| command.arg("protocol").set_raw_out(true))
            .map_err(|error| format!("Could not resolve the bundled verification engine: {error}")),
        #[cfg(debug_assertions)]
        EngineInvocation::DebugCommand { program, args } => {
            Ok(app.shell().command(program).args(args).set_raw_out(true))
        }
    }
}

#[tauri::command]
async fn select_repository() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("Open Git repository")
        .pick_folder()
        .await
        .map(|handle| handle.path().to_string_lossy().into_owned())
}

#[tauri::command]
async fn engine_request(
    app: AppHandle,
    processes: State<'_, EngineProcesses>,
    request_line: String,
    on_event: Channel<String>,
) -> Result<String, String> {
    let identity: RequestIdentity = serde_json::from_str(request_line.trim())
        .map_err(|error| format!("Protocol request is not valid JSON: {error}"))?;
    if identity.protocol_version != PROTOCOL_VERSION
        || identity.id.is_empty()
        || identity.id.len() > 256
        || identity.method.is_empty()
    {
        return Err("Only non-empty protocol version 1 requests are supported.".to_string());
    }

    let _request_guard = processes.request_lock.lock().await;
    let cancellable = identity.method == "verification.run";
    {
        let mut registry = processes
            .registry
            .lock()
            .map_err(|_| "Engine process state is unavailable.".to_string())?;
        registry.begin_request(&identity.id, cancellable)?;
    }

    let result =
        run_engine_request(&app, &processes, &identity, request_line.trim(), on_event).await;

    let cleanup = processes
        .registry
        .lock()
        .map_err(|_| "Engine process state is unavailable.".to_string())
        .map(|mut registry| registry.finish_request(&identity.id));
    match (result, cleanup) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
        (Ok(terminal), Ok(())) => Ok(terminal),
    }
}

async fn run_engine_request(
    app: &AppHandle,
    processes: &EngineProcesses,
    identity: &RequestIdentity,
    request_line: &str,
    on_event: Channel<String>,
) -> Result<String, String> {
    let command = engine_command(app, engine_invocation()?)?;
    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("Could not start the local verification engine: {error}"))?;
    let process_id = child.pid();
    let process_tree = match ProcessTreeGuard::attach(process_id) {
        Ok(process_tree) => process_tree,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };

    let active = Arc::new(ActiveEngine::new(
        identity.id.clone(),
        identity.method == "verification.run",
        child,
        process_tree,
    ));
    let cancellation_was_pending = processes
        .registry
        .lock()
        .map_err(|_| "Engine process state is unavailable.".to_string())?
        .register_active(&identity.id, Arc::clone(&active))?;
    let pending_cancel_request_id =
        cancellation_was_pending.then(|| next_cancel_request_id(processes));
    if let Err(error) = active.start_request(request_line, pending_cancel_request_id) {
        let _ = active.terminate_tree();
        return Err(error);
    }

    let mut stream = ProtocolStreamState::default();
    let mut stdout = NdjsonBuffer::default();
    let mut diagnostics = String::new();
    let mut exit_code: Option<Option<i32>> = None;

    while exit_code.is_none() {
        let deadline = if stream.terminal.is_some() {
            stream.shutdown_deadline
        } else {
            active.cancellation_deadline()?
        };
        let event = receive_engine_event(&mut events, deadline).await;
        let Some(event) = event else {
            active.terminate_tree()?;
            return if stream.terminal.is_some() {
                Err(format!(
                    "Verification engine process {process_id} did not exit after its terminal protocol message."
                ))
            } else {
                Err(format!(
                    "Verification engine process {process_id} did not persist an interrupted terminal result within the cancellation grace period."
                ))
            };
        };

        match event {
            CommandEvent::Stdout(bytes) => {
                for line in stdout.push(&bytes)? {
                    stream.accept_line(&line, identity, &active, &on_event)?;
                }
            }
            CommandEvent::Stderr(bytes) => append_diagnostics(&mut diagnostics, &bytes),
            CommandEvent::Error(error) => {
                active.terminate_tree()?;
                return Err(format!(
                    "Could not read verification engine output: {error}"
                ));
            }
            CommandEvent::Terminated(payload) => {
                for line in stdout.finish()? {
                    stream.accept_line(&line, identity, &active, &on_event)?;
                }
                exit_code = Some(payload.code);
            }
            _ => {}
        }
    }

    if exit_code.flatten() != Some(0) {
        return Err(format!(
            "Engine exited with code {}. {}",
            exit_code
                .flatten()
                .map_or_else(|| "unknown".to_string(), |code| code.to_string()),
            diagnostics.trim()
        ));
    }
    let terminal = stream.terminal.as_deref().ok_or_else(|| {
        format!(
            "Engine exited without a terminal protocol message. {}",
            diagnostics.trim()
        )
    })?;
    stream.validate_cancellation(terminal, active.cancellation_request_id()?.is_some())?;
    Ok(terminal.to_string())
}

#[derive(Default)]
struct ProtocolStreamState {
    terminal: Option<String>,
    cancellation_acknowledged: Option<bool>,
    shutdown_deadline: Option<Instant>,
}

impl ProtocolStreamState {
    fn accept_line(
        &mut self,
        line: &str,
        identity: &RequestIdentity,
        active: &ActiveEngine,
        on_event: &Channel<String>,
    ) -> Result<(), String> {
        let cancel_request_id = active.cancellation_request_id()?;
        match route_protocol_message(line, &identity.id, cancel_request_id.as_deref())? {
            RoutedMessage::Event(line) => {
                if self.terminal.is_some() {
                    return Err(
                        "Engine emitted an event after its terminal protocol message.".to_string(),
                    );
                }
                on_event
                    .send(line)
                    .map_err(|error| format!("Could not forward an engine event: {error}"))?;
            }
            RoutedMessage::OriginalTerminal(line) => {
                if self.terminal.replace(line).is_some() {
                    return Err(
                        "Engine emitted more than one terminal protocol message.".to_string()
                    );
                }
                active.mark_terminal_and_close_stdin()?;
                self.shutdown_deadline = Some(Instant::now() + ENGINE_SHUTDOWN_GRACE);
            }
            RoutedMessage::CancellationAcknowledgement(accepted) => {
                if self.cancellation_acknowledged.replace(accepted).is_some() {
                    return Err(
                        "Engine emitted more than one cancellation acknowledgement.".to_string()
                    );
                }
            }
        }
        Ok(())
    }

    fn validate_cancellation(
        &self,
        terminal: &str,
        cancellation_requested: bool,
    ) -> Result<(), String> {
        if !cancellation_requested {
            return Ok(());
        }
        let accepted = self.cancellation_acknowledged.ok_or_else(|| {
            "Engine exited without acknowledging the cancellation control request.".to_string()
        })?;
        if !accepted {
            return Ok(());
        }

        let message: Value = serde_json::from_str(terminal).map_err(|error| {
            format!("Could not validate the cancelled terminal result: {error}")
        })?;
        if message
            .get("result")
            .and_then(Value::as_object)
            .and_then(|result| result.get("status"))
            .and_then(Value::as_str)
            != Some("cancelled")
        {
            return Err(
                "Engine accepted cancellation but did not return a persisted cancelled run."
                    .to_string(),
            );
        }
        Ok(())
    }
}

async fn receive_engine_event(
    events: &mut tauri::async_runtime::Receiver<CommandEvent>,
    deadline: Option<Instant>,
) -> Option<CommandEvent> {
    loop {
        if let Some(deadline) = deadline {
            return tokio::time::timeout_at(deadline, events.recv())
                .await
                .ok()
                .flatten();
        }
        match tokio::time::timeout(EVENT_WAIT_POLL, events.recv()).await {
            Ok(event) => return event,
            Err(_) => continue,
        }
    }
}

fn append_diagnostics(diagnostics: &mut String, bytes: &[u8]) {
    const MAX_DIAGNOSTICS_BYTES: usize = 16 * 1024;
    diagnostics.push_str(&String::from_utf8_lossy(bytes));
    if diagnostics.len() > MAX_DIAGNOSTICS_BYTES {
        let mut split = diagnostics.len() - MAX_DIAGNOSTICS_BYTES;
        while !diagnostics.is_char_boundary(split) {
            split += 1;
        }
        diagnostics.drain(..split);
    }
}

fn next_cancel_request_id(processes: &EngineProcesses) -> String {
    format!(
        "native-cancel-{}",
        processes.next_cancel_id.fetch_add(1, Ordering::Relaxed)
    )
}

#[tauri::command]
async fn engine_interrupt(
    processes: State<'_, EngineProcesses>,
    request_id: String,
) -> Result<bool, String> {
    if request_id.is_empty() || request_id.len() > 256 {
        return Err("Cancellation requires a valid protocol request ID.".to_string());
    }

    let disposition = processes
        .registry
        .lock()
        .map_err(|_| "Engine process state is unavailable.".to_string())?
        .interrupt(&request_id);
    match disposition {
        InterruptDisposition::Active(engine) => {
            let cancel_id = next_cancel_request_id(&processes);
            match engine.send_cancellation(cancel_id) {
                Ok(accepted) => Ok(accepted),
                Err(error) => {
                    let cleanup_error = engine.terminate_tree().err();
                    match cleanup_error {
                        Some(cleanup_error) => {
                            Err(format!("{error} Cleanup also failed: {cleanup_error}"))
                        }
                        None => Err(error),
                    }
                }
            }
        }
        InterruptDisposition::Queued(accepted) => Ok(accepted),
        InterruptDisposition::Rejected => Ok(false),
    }
}

struct ProcessTreeGuard {
    process_id: u32,
    #[cfg(windows)]
    job: WindowsJob,
}

impl ProcessTreeGuard {
    fn attach(process_id: u32) -> Result<Self, String> {
        #[cfg(windows)]
        {
            WindowsJob::attach(process_id).map(|job| Self { process_id, job })
        }

        #[cfg(not(windows))]
        {
            Ok(Self { process_id })
        }
    }

    #[cfg(windows)]
    fn terminate(&self) -> Result<(), String> {
        self.job.terminate().map_err(|error| {
            format!(
                "Could not terminate verification process tree {}: {error}",
                self.process_id
            )
        })
    }
}

#[cfg(windows)]
struct WindowsJob {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for WindowsJob {}
#[cfg(windows)]
unsafe impl Sync for WindowsJob {}

#[cfg(windows)]
impl WindowsJob {
    fn attach(process_id: u32) -> Result<Self, String> {
        use std::{ffi::c_void, io, mem::size_of, ptr};
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::{
                JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
                Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
            },
        };

        // SAFETY: null security/name pointers request an unnamed job with default security.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "Could not create a Windows Job Object: {}",
                io::Error::last_os_error()
            ));
        }
        let job = Self { handle };

        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `limits` is correctly sized for the selected information class.
        if unsafe {
            SetInformationJobObject(
                job.handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(format!(
                "Could not configure the Windows Job Object: {}",
                io::Error::last_os_error()
            ));
        }

        // PROCESS_SET_QUOTA and PROCESS_TERMINATE are required for job assignment.
        // SAFETY: the PID was returned by the just-spawned sidecar process.
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, process_id) };
        if process.is_null() {
            return Err(format!(
                "Could not open verification engine process {process_id}: {}",
                io::Error::last_os_error()
            ));
        }

        // SAFETY: both handles are live and owned by this scope while assignment runs.
        let assigned = unsafe { AssignProcessToJobObject(job.handle, process) };
        let assignment_error = if assigned == 0 {
            Some(io::Error::last_os_error())
        } else {
            None
        };
        // SAFETY: `process` was opened successfully above and is no longer needed.
        unsafe { CloseHandle(process) };
        if let Some(error) = assignment_error {
            return Err(format!(
                "Could not assign verification engine process {process_id} to its Windows Job Object: {error}"
            ));
        }
        Ok(job)
    }

    fn terminate(&self) -> Result<(), std::io::Error> {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;

        // SAFETY: `handle` remains owned by this guard until Drop.
        if unsafe { TerminateJobObject(self.handle, 3) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        // SAFETY: this is the single close for the handle created in `attach`.
        unsafe { CloseHandle(self.handle) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(EngineProcesses::default())
        .invoke_handler(tauri::generate_handler![
            select_repository,
            engine_request,
            engine_interrupt
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Local Code Verifier desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_original_events_and_terminals_separately_from_cancel_acknowledgements() {
        assert_eq!(
            route_protocol_message(
                r#"{"protocolVersion":1,"id":"run-1","event":"check.output","data":{}}"#,
                "run-1",
                Some("cancel-1")
            ),
            Ok(RoutedMessage::Event(
                r#"{"protocolVersion":1,"id":"run-1","event":"check.output","data":{}}"#
                    .to_string()
            ))
        );
        assert_eq!(
            route_protocol_message(
                r#"{"protocolVersion":1,"id":"cancel-1","result":{"accepted":true}}"#,
                "run-1",
                Some("cancel-1")
            ),
            Ok(RoutedMessage::CancellationAcknowledgement(true))
        );
        assert_eq!(
            route_protocol_message(
                r#"{"protocolVersion":1,"id":"run-1","result":{"status":"cancelled"}}"#,
                "run-1",
                Some("cancel-1")
            ),
            Ok(RoutedMessage::OriginalTerminal(
                r#"{"protocolVersion":1,"id":"run-1","result":{"status":"cancelled"}}"#.to_string()
            ))
        );
    }

    #[test]
    fn rejects_unknown_correlation_ids_and_invalid_cancel_acknowledgements() {
        assert!(route_protocol_message(
            r#"{"protocolVersion":1,"id":"other","result":{}}"#,
            "run-1",
            Some("cancel-1")
        )
        .unwrap_err()
        .contains("unexpected request ID"));
        assert!(route_protocol_message(
            r#"{"protocolVersion":1,"id":"cancel-1","result":{"accepted":"yes"}}"#,
            "run-1",
            Some("cancel-1")
        )
        .unwrap_err()
        .contains("invalid cancellation acknowledgement"));
    }

    #[test]
    fn buffers_split_crlf_and_unterminated_ndjson_frames() {
        let mut buffer = NdjsonBuffer::default();
        assert!(buffer.push(b"{\"one\":").unwrap().is_empty());
        assert_eq!(
            buffer.push(b"1}\r\n{\"two\":2}").unwrap(),
            [r#"{"one":1}"#.to_string()]
        );
        assert_eq!(buffer.finish().unwrap(), [r#"{"two":2}"#.to_string()]);
    }

    #[test]
    fn rejects_an_oversized_pending_protocol_line() {
        let mut buffer = NdjsonBuffer::default();
        let error = buffer
            .push(&vec![b'x'; MAX_PROTOCOL_LINE_BYTES + 1])
            .unwrap_err();
        assert!(error.contains("exceeds"));
    }

    #[test]
    fn cancellation_request_uses_a_distinct_correlated_protocol_v1_frame() {
        let encoded = encode_cancellation_request("cancel-7", "run-1").unwrap();
        let value: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["id"], "cancel-7");
        assert_eq!(value["method"], "verification.cancel");
        assert_eq!(value["params"]["targetRequestId"], "run-1");
    }

    #[test]
    fn prelaunch_cancellation_is_bounded_and_idempotent() {
        let mut registry = ProcessRegistry::default();
        assert!(matches!(
            registry.interrupt("run-1"),
            InterruptDisposition::Queued(true)
        ));
        assert!(matches!(
            registry.interrupt("run-1"),
            InterruptDisposition::Queued(false)
        ));
        registry.begin_request("run-1", true).unwrap();
        assert!(registry.remove_pending("run-1"));
        registry.finish_request("run-1");
        assert!(matches!(
            registry.interrupt("run-1"),
            InterruptDisposition::Rejected
        ));
    }

    #[test]
    fn cancellation_racing_with_start_is_retained() {
        use std::sync::Barrier;

        let registry = Arc::new(Mutex::new(ProcessRegistry::default()));
        let barrier = Arc::new(Barrier::new(3));
        let start_registry = Arc::clone(&registry);
        let start_barrier = Arc::clone(&barrier);
        let start = std::thread::spawn(move || {
            start_barrier.wait();
            start_registry
                .lock()
                .unwrap()
                .begin_request("run-race", true)
                .unwrap();
        });
        let cancel_registry = Arc::clone(&registry);
        let cancel_barrier = Arc::clone(&barrier);
        let cancel = std::thread::spawn(move || {
            cancel_barrier.wait();
            assert!(matches!(
                cancel_registry.lock().unwrap().interrupt("run-race"),
                InterruptDisposition::Queued(true)
            ));
        });
        barrier.wait();
        start.join().unwrap();
        cancel.join().unwrap();
        assert!(registry.lock().unwrap().remove_pending("run-race"));
    }

    #[test]
    fn completed_request_ids_can_be_reused_but_still_reject_late_interrupts() {
        let mut registry = ProcessRegistry::default();
        registry.begin_request("desktop-1", false).unwrap();
        registry.finish_request("desktop-1");
        assert!(matches!(
            registry.interrupt("desktop-1"),
            InterruptDisposition::Rejected
        ));

        registry.begin_request("desktop-1", false).unwrap();
        registry.finish_request("desktop-1");
    }

    #[test]
    fn accepted_cancellation_requires_a_cancelled_terminal_result() {
        let accepted = ProtocolStreamState {
            cancellation_acknowledged: Some(true),
            ..ProtocolStreamState::default()
        };
        assert!(accepted
            .validate_cancellation(
                r#"{"protocolVersion":1,"id":"run-1","result":{"status":"completed"}}"#,
                true
            )
            .unwrap_err()
            .contains("did not return a persisted cancelled run"));
        accepted
            .validate_cancellation(
                r#"{"protocolVersion":1,"id":"run-1","result":{"status":"cancelled"}}"#,
                true,
            )
            .unwrap();

        let rejected = ProtocolStreamState {
            cancellation_acknowledged: Some(false),
            ..ProtocolStreamState::default()
        };
        rejected
            .validate_cancellation(
                r#"{"protocolVersion":1,"id":"run-1","result":{"status":"completed"}}"#,
                true,
            )
            .unwrap();
        assert!(ProtocolStreamState::default()
            .validate_cancellation(
                r#"{"protocolVersion":1,"id":"run-1","result":{"status":"cancelled"}}"#,
                true
            )
            .unwrap_err()
            .contains("without acknowledging"));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_override_is_explicit_and_sidecar_is_the_default() {
        assert!(matches!(
            debug_engine_invocation(None, None).unwrap(),
            EngineInvocation::Sidecar
        ));
        let invocation = debug_engine_invocation(
            Some("node.exe".to_string()),
            Some(r#"["engine.js","protocol"]"#.to_string()),
        )
        .unwrap();
        match invocation {
            EngineInvocation::DebugCommand { program, args } => {
                assert_eq!(program, "node.exe");
                assert_eq!(args, ["engine.js", "protocol"]);
            }
            EngineInvocation::Sidecar => panic!("expected a debug command override"),
        }
    }
}
