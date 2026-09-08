export type FailurePolicy = 'block' | 'warn';

export type VerificationCheckStatus =
  'passed' | 'warning' | 'failed' | 'error' | 'cancelled' | 'skipped';

export type VerificationRunStatus = 'running' | 'completed' | 'error' | 'cancelled';

export type GateStatus = 'PASS' | 'WARN' | 'BLOCK';

export type FindingSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ArtifactMetadataValue = string | number | boolean | null;

export interface Finding {
  readonly id: string;
  readonly source: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly ruleId?: string;
}

export interface Artifact {
  readonly type: string;
  readonly path: string;
  readonly source: string;
  readonly name?: string;
  readonly metadata?: Readonly<Record<string, ArtifactMetadataValue>>;
}

export interface VerificationSuite {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly command: string;
  readonly failurePolicy: FailurePolicy;
  readonly timeoutMs?: number;
}

export type VerificationCheck = VerificationSuite;

export interface VerificationCheckResult {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly command?: string;
  readonly failurePolicy: FailurePolicy;
  readonly status: VerificationCheckStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly errorSummary?: string;
  readonly findings: readonly Finding[];
  readonly artifacts: readonly Artifact[];
}

export interface GateSummary {
  readonly total: number;
  readonly passed: number;
  readonly warning: number;
  readonly failed: number;
  readonly error: number;
  readonly cancelled: number;
  readonly skipped: number;
}

export interface GateResult {
  readonly status: GateStatus;
  readonly reasons: readonly string[];
  readonly evaluatedAt: string;
  readonly summary: GateSummary;
}

export interface VerificationRun {
  readonly id: string;
  readonly projectId?: string;
  readonly repositoryRoot: string;
  readonly status: VerificationRunStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly checks: readonly VerificationCheckResult[];
  readonly gate?: GateResult;
}

export const VERIFICATION_CHECK_STATUSES = [
  'passed',
  'warning',
  'failed',
  'error',
  'cancelled',
  'skipped',
] as const satisfies readonly VerificationCheckStatus[];

export function summarizeCheckResults(
  results: readonly Pick<VerificationCheckResult, 'status'>[],
): GateSummary {
  const counts: Record<VerificationCheckStatus, number> = {
    passed: 0,
    warning: 0,
    failed: 0,
    error: 0,
    cancelled: 0,
    skipped: 0,
  };

  for (const result of results) {
    counts[result.status] += 1;
  }

  return {
    total: results.length,
    ...counts,
  };
}

export function isTerminalCheckStatus(status: VerificationCheckStatus): boolean {
  return VERIFICATION_CHECK_STATUSES.includes(status);
}

export function isUnsuccessfulCheckStatus(status: VerificationCheckStatus): boolean {
  return status === 'failed' || status === 'error' || status === 'cancelled';
}
