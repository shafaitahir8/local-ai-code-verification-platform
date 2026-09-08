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
