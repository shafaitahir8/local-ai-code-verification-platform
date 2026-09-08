use std::{
    collections::HashMap,
    env,
    path::PathBuf,
    process::Stdio,
    sync::Mutex,
};

use serde::Deserialize;
use serde_json::Value;
use tauri::{ipc::Channel, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex as AsyncMutex,
};

#[derive(Default)]
struct EngineProcesses {
    active: Mutex<HashMap<String, u32>>,
    request_lock: AsyncMutex<()>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestIdentity {
    protocol_version: u8,
    id: String,
}

fn default_engine_path() -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let apps = manifest
        .parent()
        .and_then(|desktop| desktop.parent())
        .ok_or_else(|| "Could not resolve the workspace apps directory.".to_string())?;
    Ok(apps.join("cli").join("dist").join("index.js"))
}

fn engine_invocation() -> Result<(String, Vec<String>), String> {
    if let Ok(command) = env::var("VERIFY_ENGINE_COMMAND") {
        let args = match env::var("VERIFY_ENGINE_ARGS_JSON") {
            Ok(source) => serde_json::from_str::<Vec<String>>(&source)
                .map_err(|error| format!("VERIFY_ENGINE_ARGS_JSON is invalid: {error}"))?,
            Err(_) => Vec::new(),
        };
        return Ok((command, args));
    }

    let engine = default_engine_path()?;
    if !engine.is_file() {
        return Err(format!(
            "The development engine was not found at {}. Run `pnpm --filter @verify/cli build` first.",
            engine.display()
        ));
    }
    Ok(("node".to_string(), vec![engine.display().to_string(), "protocol".to_string()]))
}

fn configure_process_group(command: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }

    #[cfg(unix)]
    {
        command.process_group(0);
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
    processes: State<'_, EngineProcesses>,
    request_line: String,
    on_event: Channel<String>,
) -> Result<String, String> {
    let identity: RequestIdentity = serde_json::from_str(request_line.trim())
        .map_err(|error| format!("Protocol request is not valid JSON: {error}"))?;
    if identity.protocol_version != 1 || identity.id.is_empty() {
        return Err("Only non-empty protocol version 1 requests are supported.".to_string());
    }

    let _request_guard = processes.request_lock.lock().await;
    let result = async {
        let (executable, args) = engine_invocation()?;
        let mut command = Command::new(executable);
        command
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        configure_process_group(&mut command);

        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start the local verification engine: {error}"))?;
        let process_id = child
            .id()
            .ok_or_else(|| "The verification engine did not expose a process ID.".to_string())?;
        processes
            .active
            .lock()
            .map_err(|_| "Engine process state is unavailable.".to_string())?
            .insert(identity.id.clone(), process_id);

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "The verification engine stdin pipe is unavailable.".to_string())?;
        stdin
            .write_all(format!("{}\n", request_line.trim()).as_bytes())
            .await
            .map_err(|error| format!("Could not send the protocol request: {error}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|error| format!("Could not close the protocol request stream: {error}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "The verification engine stdout pipe is unavailable.".to_string())?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| "The verification engine stderr pipe is unavailable.".to_string())?;
        let stderr_task = tauri::async_runtime::spawn(async move {
            let mut diagnostics = String::new();
            let _ = stderr.read_to_string(&mut diagnostics).await;
            diagnostics
        });

        let mut lines = BufReader::new(stdout).lines();
        let mut terminal: Option<String> = None;
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|error| format!("Could not read an engine protocol message: {error}"))?
        {
            let message: Value = serde_json::from_str(&line)
                .map_err(|error| format!("Engine emitted invalid protocol JSON: {error}"))?;
            if message.get("event").is_some() {
                on_event
                    .send(line)
                    .map_err(|error| format!("Could not forward an engine event: {error}"))?;
            } else if message.get("result").is_some() || message.get("error").is_some() {
                if terminal.replace(line).is_some() {
                    return Err("Engine emitted more than one terminal protocol message.".to_string());
                }
            } else {
                return Err("Engine emitted an unknown protocol envelope.".to_string());
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|error| format!("Could not wait for the verification engine: {error}"))?;
        let diagnostics = stderr_task.await.unwrap_or_default();
        if !status.success() {
            return Err(format!(
                "Engine exited with {}. {}",
                status,
                diagnostics.trim()
            ));
        }

        terminal.ok_or_else(|| {
            format!(
                "Engine exited without a terminal protocol message. {}",
                diagnostics.trim()
            )
        })
    }
    .await;

    processes
        .active
        .lock()
        .map_err(|_| "Engine process state is unavailable.".to_string())?
        .remove(&identity.id);
    result
}

#[tauri::command]
async fn engine_interrupt(
    processes: State<'_, EngineProcesses>,
    request_id: String,
) -> Result<bool, String> {
    let process_id = processes
        .active
        .lock()
        .map_err(|_| "Engine process state is unavailable.".to_string())?
        .get(&request_id)
        .copied();
    let Some(process_id) = process_id else {
        return Ok(false);
    };

    #[cfg(windows)]
    let status = {
        let process_id = process_id.to_string();
        Command::new("taskkill.exe")
            .args(["/PID", &process_id, "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
    };

    #[cfg(unix)]
    let status = {
        let process_group = format!("-{process_id}");
        Command::new("kill")
            .args(["-TERM", &process_group])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
    };

    status
        .map(|result| result.success())
        .map_err(|error| format!("Could not interrupt the engine process: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineProcesses::default())
        .invoke_handler(tauri::generate_handler![
            select_repository,
            engine_request,
            engine_interrupt
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Local Code Verifier desktop application");
}
