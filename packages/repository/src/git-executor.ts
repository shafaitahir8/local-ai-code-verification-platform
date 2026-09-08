import { execFile } from 'node:child_process';

import type { GitCommandExecutor, GitCommandResult } from './contracts.js';
import { RepositoryError } from './errors.js';

export interface SystemGitCommandExecutorOptions {
  readonly executable?: string;
  readonly maxBufferBytes?: number;
}

export class SystemGitCommandExecutor implements GitCommandExecutor {
  private readonly executable: string;
  private readonly maxBufferBytes: number;

  public constructor(options: SystemGitCommandExecutorOptions = {}) {
    this.executable = options.executable ?? 'git';
    this.maxBufferBytes = options.maxBufferBytes ?? 16 * 1024 * 1024;
  }

  public execute(args: readonly string[], cwd: string): Promise<GitCommandResult> {
    return new Promise((resolve, reject) => {
      execFile(
        this.executable,
        [...args],
        {
          cwd,
          encoding: 'utf8',
          maxBuffer: this.maxBufferBytes,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }

          if (error.code === 'ENOENT') {
            reject(
              new RepositoryError('GIT_NOT_FOUND', 'Git executable could not be found.', {
                cause: error,
              }),
            );
            return;
          }

          resolve({
            exitCode: typeof error.code === 'number' ? error.code : 1,
            stdout,
            stderr: stderr.length > 0 ? stderr : error.message,
          });
        },
      );
    });
  }
}
