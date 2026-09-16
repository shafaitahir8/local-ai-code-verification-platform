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

  public constructor(reason: 'policy-missing' | 'policy-invalid' | 'migration-required') {
    super(
      reason === 'policy-missing'
        ? 'No project policy exists to approve.'
        : reason === 'policy-invalid'
          ? 'The project policy is invalid and cannot be approved.'
          : 'Migrate the version-1 project policy before approving executable policy.',
    );
    this.name = 'PolicyApprovalUnavailableError';
  }
}
