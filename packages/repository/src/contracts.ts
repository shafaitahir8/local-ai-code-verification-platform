import type { RepositoryChange } from '@verify/domain';

export interface GitCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitCommandExecutor {
  execute(args: readonly string[], cwd: string): Promise<GitCommandResult>;
}

export interface RepositoryService {
  discoverRoot(startPath: string): Promise<string>;
  resolveRoot(startPath: string): Promise<string>;
  inspect(startPath: string): Promise<RepositoryChange>;
}
