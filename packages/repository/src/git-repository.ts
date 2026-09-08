import { normalize } from 'node:path';

import { summarizeChangedFiles } from '@verify/domain';
import type { ChangedFile, GitReference, LineStatistics, RepositoryChange } from '@verify/domain';

import type { GitCommandExecutor, GitCommandResult, RepositoryService } from './contracts.js';
import { RepositoryError } from './errors.js';
import { SystemGitCommandExecutor } from './git-executor.js';
import {
  parseNumstatZ,
  parsePorcelainV2,
  type GitNumstatEntry,
  type PorcelainBranch,
  type PorcelainFileEntry,
} from './parsers.js';

const STATUS_ARGS = [
  'status',
  '--porcelain=v2',
  '--branch',
  '-z',
  '--untracked-files=all',
  '--find-renames',
] as const;

const UNSTAGED_NUMSTAT_ARGS = [
  'diff',
  '--no-ext-diff',
  '--numstat',
  '-z',
  '--find-renames',
  '--',
] as const;

const STAGED_NUMSTAT_ARGS = [
  'diff',
  '--cached',
  '--no-ext-diff',
  '--numstat',
  '-z',
  '--find-renames',
  '--',
] as const;

function commandFailure(args: readonly string[], result: GitCommandResult): RepositoryError {
  const details = result.stderr.trim();
  return new RepositoryError(
    'GIT_COMMAND_FAILED',
    `Git command failed (git ${args.join(' ')}): ${details || `exit code ${result.exitCode}`}`,
  );
}

function numstatMap(entries: readonly GitNumstatEntry[]): Map<string, GitNumstatEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]));
}

function mergeStatistics(
  status: PorcelainFileEntry,
  stagedStats: ReadonlyMap<string, GitNumstatEntry>,
  unstagedStats: ReadonlyMap<string, GitNumstatEntry>,
): LineStatistics {
  const expected: (GitNumstatEntry | undefined)[] = [];
  if (status.staged) expected.push(stagedStats.get(status.path));
  if (status.unstaged) expected.push(unstagedStats.get(status.path));

  const available = expected.filter((entry): entry is GitNumstatEntry => entry !== undefined);
  if (available.length === 0) {
    return { additions: null, deletions: null, binary: false, known: false };
  }

  const binary = available.some((entry) => entry.binary);
  if (binary) {
    return {
      additions: null,
      deletions: null,
      binary: true,
      known: available.length === expected.length,
    };
  }

  return {
    additions: available.reduce((total, entry) => total + (entry.additions ?? 0), 0),
    deletions: available.reduce((total, entry) => total + (entry.deletions ?? 0), 0),
    binary: false,
    known: available.length === expected.length,
  };
}

function gitReference(branch: PorcelainBranch): GitReference {
  if (branch.oid === '(initial)') {
    return { kind: 'unborn', name: branch.head ?? 'HEAD' };
  }

  if (branch.head !== null) {
    return {
      kind: 'branch',
      name: branch.head,
      ...(branch.oid === null ? {} : { oid: branch.oid }),
    };
  }

  return {
    kind: 'commit',
    name: branch.oid ?? 'HEAD',
    ...(branch.oid === null ? {} : { oid: branch.oid }),
  };
}

export class GitRepositoryService implements RepositoryService {
  public constructor(
    private readonly executor: GitCommandExecutor = new SystemGitCommandExecutor(),
  ) {}

  public async discoverRoot(startPath: string): Promise<string> {
    const args = ['rev-parse', '--show-toplevel'] as const;
    const result = await this.executor.execute(args, startPath);

    if (result.exitCode !== 0) {
      if (/not a git repository/iu.test(result.stderr)) {
        throw new RepositoryError(
          'NOT_A_GIT_REPOSITORY',
          `No Git repository was found from ${startPath}.`,
        );
      }
      throw commandFailure(args, result);
    }

    const root = result.stdout.trim();
    if (root.length === 0) {
      throw new RepositoryError('GIT_OUTPUT_INVALID', 'Git returned an empty repository root.');
    }
    return normalize(root);
  }

  public resolveRoot(startPath: string): Promise<string> {
    return this.discoverRoot(startPath);
  }

  public async inspect(startPath: string): Promise<RepositoryChange> {
    const repositoryRoot = await this.discoverRoot(startPath);
    const [statusResult, stagedResult, unstagedResult] = await Promise.all([
      this.executor.execute(STATUS_ARGS, repositoryRoot),
      this.executor.execute(STAGED_NUMSTAT_ARGS, repositoryRoot),
      this.executor.execute(UNSTAGED_NUMSTAT_ARGS, repositoryRoot),
    ]);

    for (const [args, result] of [
      [STATUS_ARGS, statusResult],
      [STAGED_NUMSTAT_ARGS, stagedResult],
      [UNSTAGED_NUMSTAT_ARGS, unstagedResult],
    ] as const) {
      if (result.exitCode !== 0) throw commandFailure(args, result);
    }

    const status = parsePorcelainV2(statusResult.stdout);
    const stagedStats = numstatMap(parseNumstatZ(stagedResult.stdout));
    const unstagedStats = numstatMap(parseNumstatZ(unstagedResult.stdout));
    const files: ChangedFile[] = status.files
      .map((file) => ({
        path: file.path,
        ...(file.originalPath === undefined ? {} : { originalPath: file.originalPath }),
        status: file.status,
        staged: file.staged,
        unstaged: file.unstaged,
        stagedStatus: file.stagedStatus,
        unstagedStatus: file.unstagedStatus,
        statistics: mergeStatistics(file, stagedStats, unstagedStats),
      }))
      .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    const summary = summarizeChangedFiles(files);

    return {
      repositoryRoot,
      branch: status.branch.head,
      head: gitReference(status.branch),
      ...(status.branch.upstream === undefined ? {} : { upstream: status.branch.upstream }),
      ahead: status.branch.ahead,
      behind: status.branch.behind,
      ...summary,
      files,
    };
  }
}

export async function discoverRepositoryRoot(startPath: string): Promise<string> {
  return new GitRepositoryService().discoverRoot(startPath);
}

export async function inspectRepository(startPath: string): Promise<RepositoryChange> {
  return new GitRepositoryService().inspect(startPath);
}
