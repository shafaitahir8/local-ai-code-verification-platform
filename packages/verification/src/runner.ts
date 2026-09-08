import type { VerificationCheckResult } from '@verify/domain';

import type {
  VerificationAdapter,
  VerificationRunEvidence,
  VerificationRunRequest,
} from './contracts.js';

export const MAX_RETAINED_OUTPUT_JSON_CHARACTERS = 1024 * 1024;
const OUTPUT_TRUNCATION_MARKER = '\n[output truncated by Local Code Verifier]\n';

interface RetainedText {
  readonly value: string;
  readonly serializedLength: number;
}

function retainText(value: string, available: number): RetainedText {
  const serializedLength = JSON.stringify(value).length;
  if (serializedLength <= available) return { value, serializedLength };

  const markerLength = JSON.stringify(OUTPUT_TRUNCATION_MARKER).length;
  if (markerLength > available) {
    const marker = '[truncated]';
    return { value: marker, serializedLength: JSON.stringify(marker).length };
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidateLength = JSON.stringify(
      value.slice(0, middle) + OUTPUT_TRUNCATION_MARKER,
    ).length;
    if (candidateLength <= available) low = middle;
    else high = middle - 1;
  }

  const retained = value.slice(0, low) + OUTPUT_TRUNCATION_MARKER;
  return { value: retained, serializedLength: JSON.stringify(retained).length };
}

function retainResultOutput(
  result: VerificationCheckResult,
  usedCharacters: number,
): { readonly result: VerificationCheckResult; readonly usedCharacters: number } {
  let used = usedCharacters;
  let stdout = result.stdout;
  let stderr = result.stderr;

  if (stdout !== undefined && stdout.length > 0) {
    const retained = retainText(stdout, Math.max(0, MAX_RETAINED_OUTPUT_JSON_CHARACTERS - used));
    stdout = retained.value;
    used += retained.serializedLength;
  }
  if (stderr !== undefined && stderr.length > 0) {
    const retained = retainText(stderr, Math.max(0, MAX_RETAINED_OUTPUT_JSON_CHARACTERS - used));
    stderr = retained.value;
    used += retained.serializedLength;
  }

  return {
    result: { ...result, stdout, stderr },
    usedCharacters: used,
  };
}

export class VerificationRunner {
  public constructor(private readonly adapter: VerificationAdapter) {}

  public async run(request: VerificationRunRequest): Promise<VerificationRunEvidence> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const results: VerificationCheckResult[] = [];
    let interrupted = false;
    let retainedOutputCharacters = 0;

    for (const check of request.checks) {
      if (request.signal?.aborted === true) {
        interrupted = true;
        break;
      }

      request.onEvent?.({ type: 'check.started', check, timestamp: new Date().toISOString() });

      const adapterResult = await this.adapter.execute(check, {
        repositoryRoot: request.repositoryRoot,
        environment: request.environment,
        signal: request.signal,
        timeoutMs: check.timeoutMs ?? request.defaultTimeoutMs,
        onOutput: (event) => request.onEvent?.({ type: 'check.output', ...event }),
      });
      const retained = retainResultOutput(adapterResult, retainedOutputCharacters);
      const result = retained.result;
      retainedOutputCharacters = retained.usedCharacters;

      results.push(result);
      request.onEvent?.({
        type: 'check.completed',
        result,
        timestamp: new Date().toISOString(),
      });

      if (result.status === 'cancelled') {
        interrupted = true;
        break;
      }
    }

    const completedAtMs = Date.now();
    return {
      startedAt,
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
      results,
      interrupted,
    };
  }
}
