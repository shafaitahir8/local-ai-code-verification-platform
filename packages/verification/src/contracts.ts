import type { VerificationCheck, VerificationCheckResult } from '@verify/domain';

export interface CheckOutputEvent {
  readonly checkId: string;
  readonly stream: 'stdout' | 'stderr';
  readonly chunk: string;
  readonly timestamp: string;
}

export type VerificationLifecycleEvent =
  | {
      readonly type: 'check.started';
      readonly check: VerificationCheck;
      readonly timestamp: string;
    }
  | ({ readonly type: 'check.output' } & CheckOutputEvent)
  | {
      readonly type: 'check.completed';
      readonly result: VerificationCheckResult;
      readonly timestamp: string;
    };

export interface VerificationExecutionContext {
  readonly repositoryRoot: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly onOutput?: (event: CheckOutputEvent) => void;
}

export interface VerificationAdapter {
  readonly id: string;
  execute(
    check: VerificationCheck,
    context: VerificationExecutionContext,
  ): Promise<VerificationCheckResult>;
}

export interface VerificationRunRequest {
  readonly checks: readonly VerificationCheck[];
  readonly repositoryRoot: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly defaultTimeoutMs?: number;
  readonly onEvent?: (event: VerificationLifecycleEvent) => void;
}

export interface VerificationRunEvidence {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly results: readonly VerificationCheckResult[];
  readonly interrupted: boolean;
}
