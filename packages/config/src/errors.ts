export interface ConfigValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ConfigValidationError extends Error {
  public readonly code = 'CONFIG_INVALID';

  public constructor(
    public readonly issues: readonly ConfigValidationIssue[],
    configPath = '.verify/project.yml',
  ) {
    const detail = issues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n');
    super(`${configPath} is invalid:\n${detail}`);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigNotFoundError extends Error {
  public readonly code = 'CONFIG_NOT_FOUND';

  public constructor(public readonly path: string) {
    super(`Verification configuration was not found at ${path}.`);
    this.name = 'ConfigNotFoundError';
  }
}

export class ConfigAlreadyExistsError extends Error {
  public readonly code = 'CONFIG_ALREADY_EXISTS';

  public constructor(public readonly path: string) {
    super(
      `Verification configuration already exists at ${path}. Use force explicitly to replace it.`,
    );
    this.name = 'ConfigAlreadyExistsError';
  }
}

export class ConfigUnsafePathError extends Error {
  public readonly code = 'CONFIG_UNSAFE_PATH';

  public constructor(public readonly path: string) {
    super(`Refusing to write verification configuration through the symbolic path ${path}.`);
    this.name = 'ConfigUnsafePathError';
  }
}
