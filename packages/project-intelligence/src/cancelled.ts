export class ProjectProfileCancelledError extends Error {
  public constructor() {
    super('Project profiling was cancelled.');
    this.name = 'ProjectProfileCancelledError';
  }
}

export function throwIfProjectProfileCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ProjectProfileCancelledError();
}
