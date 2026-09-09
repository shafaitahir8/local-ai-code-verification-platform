import { summarizeCheckResults } from '@verify/domain';
import type { GateResult, GateStatus, VerificationCheckResult } from '@verify/domain';

export interface QualityGateOptions {
  readonly evaluatedAt?: string;
  readonly emptyResultStatus?: Extract<GateStatus, 'WARN' | 'BLOCK'>;
  readonly interrupted?: boolean;
}

export const QUALITY_GATE_EXIT_CODES = {
  PASS: 0,
  WARN: 0,
  BLOCK: 1,
} as const satisfies Readonly<Record<GateStatus, 0 | 1>>;

function resultDecision(result: VerificationCheckResult): {
  readonly status: GateStatus;
  readonly reason?: string;
} {
  const label = `Check "${result.name}"`;

  switch (result.status) {
    case 'passed':
      return { status: 'PASS' };
    case 'warning':
      return { status: 'WARN', reason: `${label} completed with warnings.` };
    case 'skipped':
      return { status: 'WARN', reason: `${label} was skipped.` };
    case 'error':
      return { status: 'BLOCK', reason: `${label} could not be executed.` };
    case 'cancelled':
      return { status: 'BLOCK', reason: `${label} was cancelled.` };
    case 'failed':
      return result.failurePolicy === 'warn'
        ? { status: 'WARN', reason: `${label} failed under warn policy.` }
        : { status: 'BLOCK', reason: `${label} failed under block policy.` };
  }
}

export function evaluateQualityGate(
  results: readonly VerificationCheckResult[],
  options: QualityGateOptions = {},
): GateResult {
  const summary = summarizeCheckResults(results);
  const reasons: string[] = [];
  let status: GateStatus = 'PASS';

  if (results.length === 0) {
    status = options.emptyResultStatus ?? 'WARN';
    reasons.push('No verification checks were run.');
  }

  for (const result of results) {
    const decision = resultDecision(result);

    if (decision.reason !== undefined) {
      reasons.push(decision.reason);
    }

    if (decision.status === 'BLOCK') {
      status = 'BLOCK';
    } else if (decision.status === 'WARN' && status === 'PASS') {
      status = 'WARN';
    }
  }

  if (options.interrupted === true && status !== 'BLOCK') {
    status = 'BLOCK';
    reasons.push('Verification was interrupted.');
  }

  return {
    status,
    reasons,
    evaluatedAt: options.evaluatedAt ?? new Date().toISOString(),
    summary,
  };
}

export function gateStatusToExitCode(status: GateStatus): 0 | 1 {
  return QUALITY_GATE_EXIT_CODES[status];
}
