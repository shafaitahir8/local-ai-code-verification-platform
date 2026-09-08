import { spawn, type ChildProcess } from 'node:child_process';

import type { VerificationCheck, VerificationCheckResult } from '@verify/domain';
import type { VerificationAdapter, VerificationExecutionContext } from '@verify/verification';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const FORCE_KILL_GRACE_MS = 1_000;
const MAX_CAPTURED_STREAM_CHARACTERS = 512 * 1024;
const OUTPUT_TRUNCATION_MARKER = '\n[output truncated by Local Code Verifier]\n';

interface CompletionState {
  readonly status: VerificationCheckResult['status'];
  readonly exitCode?: number;
  readonly errorSummary?: string;
}

export class GenericCommandAdapter implements VerificationAdapter {
  public readonly id = 'generic-command';

  public execute(
    check: VerificationCheck,
    context: VerificationExecutionContext,
  ): Promise<VerificationCheckResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();

    if (context.signal?.aborted === true) {
      return Promise.resolve(
        createResult(check, startedAt, startedAtMs, '', '', {
          status: 'cancelled',
          errorSummary: 'Command execution was cancelled before it started.',
        }),
      );
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let completed = false;
      let timedOut = false;
      let cancelled = false;
      const timeoutMs = context.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let child: ChildProcess | undefined;

      const complete = (state: CompletionState): void => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutHandle);
        context.signal?.removeEventListener('abort', handleAbort);
        resolve(createResult(check, startedAt, startedAtMs, stdout, stderr, state));
      };

      const terminate = (): void => {
        if (child === undefined || child.killed) return;
        terminateProcessTree(child, 'SIGTERM');
        const forceKill = setTimeout(() => {
          if (child !== undefined && child.exitCode === null && child.signalCode === null) {
            terminateProcessTree(child, 'SIGKILL');
          }
        }, FORCE_KILL_GRACE_MS);
        forceKill.unref();
      };

      const handleAbort = (): void => {
        cancelled = true;
        terminate();
      };

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
      timeoutHandle.unref();

      try {
        child = spawn(check.command, {
          cwd: context.repositoryRoot,
          env: { ...process.env, ...context.environment },
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          windowsHide: true,
        });
      } catch (error) {
        complete({
          status: 'error',
          errorSummary: describeSpawnError(error),
        });
        return;
      }

      context.signal?.addEventListener('abort', handleAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stdout = appendCapturedOutput(stdout, text);
        context.onOutput?.({
          checkId: check.id,
          stream: 'stdout',
          chunk: text,
          timestamp: new Date().toISOString(),
        });
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString();
        stderr = appendCapturedOutput(stderr, text);
        context.onOutput?.({
          checkId: check.id,
          stream: 'stderr',
          chunk: text,
          timestamp: new Date().toISOString(),
        });
      });

      child.once('error', (error) => {
        complete({ status: 'error', errorSummary: describeSpawnError(error) });
      });

      child.once('close', (exitCode) => {
        if (cancelled) {
          complete({
            status: 'cancelled',
            ...(exitCode === null ? {} : { exitCode }),
            errorSummary: 'Command execution was cancelled.',
          });
          return;
        }

        if (timedOut) {
          complete({
            status: 'error',
            ...(exitCode === null ? {} : { exitCode }),
            errorSummary: `Command timed out after ${timeoutMs}ms.`,
          });
          return;
        }

        if (exitCode === 0) {
          complete({ status: 'passed', exitCode });
          return;
        }

        if (isMissingExecutable(exitCode, stderr)) {
          complete({
            status: 'error',
            ...(exitCode === null ? {} : { exitCode }),
            errorSummary: `Configured command could not be executed: ${check.command}`,
          });
          return;
        }

        complete({
          status: 'failed',
          ...(exitCode === null ? {} : { exitCode }),
          errorSummary:
            exitCode === null
              ? 'Command ended without an exit code.'
              : `Command exited with code ${exitCode}.`,
        });
      });
    });
  }
}

function appendCapturedOutput(current: string, chunk: string): string {
  if (current.endsWith(OUTPUT_TRUNCATION_MARKER)) return current;
  const contentLimit = MAX_CAPTURED_STREAM_CHARACTERS - OUTPUT_TRUNCATION_MARKER.length;
  if (current.length + chunk.length <= contentLimit) return current + chunk;
  return (current + chunk).slice(0, contentLimit) + OUTPUT_TRUNCATION_MARKER;
}

function createResult(
  check: VerificationCheck,
  startedAt: string,
  startedAtMs: number,
  stdout: string,
  stderr: string,
  completion: CompletionState,
): VerificationCheckResult {
  const completedAtMs = Date.now();
  return {
    id: check.id,
    name: check.name,
    type: check.type,
    command: check.command,
    failurePolicy: check.failurePolicy,
    status: completion.status,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: Math.max(0, completedAtMs - startedAtMs),
    ...(completion.exitCode === undefined ? {} : { exitCode: completion.exitCode }),
    stdout,
    stderr,
    ...(completion.errorSummary === undefined ? {} : { errorSummary: completion.errorSummary }),
    findings: [],
    artifacts: [],
  };
}

function describeSpawnError(error: unknown): string {
  return error instanceof Error
    ? `Command could not be started: ${error.message}`
    : 'Command could not be started.';
}

function isMissingExecutable(exitCode: number | null, stderr: string): boolean {
  if (exitCode === 127 || exitCode === 9009) return true;
  return /(?:not found|not recognized as an internal or external command)/iu.test(stderr);
}

function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', () => child.kill(signal));
    return;
  }

  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process may have exited between the lifecycle check and the signal.
    }
  }

  child.kill(signal);
}
