export type RepositoryErrorCode =
  'GIT_NOT_FOUND' | 'NOT_A_GIT_REPOSITORY' | 'GIT_COMMAND_FAILED' | 'GIT_OUTPUT_INVALID';

export class RepositoryError extends Error {
  public constructor(
    public readonly code: RepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RepositoryError';
  }
}

export class GitParseError extends RepositoryError {
  public constructor(message: string) {
    super('GIT_OUTPUT_INVALID', message);
    this.name = 'GitParseError';
  }
}
