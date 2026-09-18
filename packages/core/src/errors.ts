import type { PolicyApprovalState } from '@verify/domain';

export class NoVerificationRunError extends Error {
  public constructor(repositoryRoot: string) {
    super(`No verification run exists for repository: ${repositoryRoot}`);
    this.name = 'NoVerificationRunError';
  }
}

export class NoQualityGateError extends Error {
  public constructor(runId: string) {
    super(`Verification run ${runId} does not contain a quality gate result.`);
    this.name = 'NoQualityGateError';
  }
}

export class PolicyApprovalStaleError extends Error {
  public readonly code = 'APPROVAL_STALE';

  public constructor() {
    super('The executable policy changed. Review its current digest before approving.');
    this.name = 'PolicyApprovalStaleError';
  }
}

export class PolicyApprovalUnavailableError extends Error {
  public readonly code = 'APPROVAL_UNAVAILABLE';

  public constructor(
    reason: Exclude<PolicyApprovalState, 'approved'>,
    action: 'approve' | 'execute' = 'approve',
  ) {
    const messages: Record<Exclude<PolicyApprovalState, 'approved'>, string> = {
      'policy-missing': 'No project policy exists.',
      'policy-invalid': 'The project policy is invalid.',
      'migration-required': 'Migrate the version-1 project policy first.',
      'not-approved': 'The executable policy has not been approved.',
      outdated: 'Approval is outdated because the executable policy changed.',
      revoked: 'The executable-policy approval was revoked.',
    };
    super(
      `${messages[reason]} ${action === 'execute' ? 'Verification did not start.' : 'Approval is unavailable.'}`,
    );
    this.name = 'PolicyApprovalUnavailableError';
  }
}
