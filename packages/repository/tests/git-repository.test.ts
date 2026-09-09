import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { GitCommandExecutor, GitCommandResult, RepositoryError } from '../src/index.js';
import { GitRepositoryService, SystemGitCommandExecutor } from '../src/index.js';

class FakeGitExecutor implements GitCommandExecutor {
  public readonly calls: { readonly args: readonly string[]; readonly cwd: string }[] = [];

  public constructor(
    private readonly handler: (
      args: readonly string[],
      cwd: string,
    ) => GitCommandResult | Promise<GitCommandResult>,
  ) {}

  public async execute(args: readonly string[], cwd: string): Promise<GitCommandResult> {
    this.calls.push({ args, cwd });
    return this.handler(args, cwd);
  }
}

const ok = (stdout = ''): GitCommandResult => ({ exitCode: 0, stdout, stderr: '' });

describe('GitRepositoryService', () => {
  it('discovers the root and combines staged and unstaged status/statistics', async () => {
    const root = normalize('C:/work/project');
    const status = [
      '# branch.oid abcdef',
      '# branch.head feature/combined',
      '# branch.upstream origin/feature/combined',
      '# branch.ab +3 -2',
      '1 MM N... 100644 100644 100644 aaa bbb src/both.ts',
      '? notes.txt',
      '',
    ].join('\0');
    const executor = new FakeGitExecutor((args) => {
      if (args[0] === 'rev-parse') return ok(`${root}\n`);
      if (args[0] === 'status') return ok(status);
      if (args.includes('--cached')) return ok('2\t1\tsrc/both.ts\0');
      return ok('3\t4\tsrc/both.ts\0');
    });

    const inspection = await new GitRepositoryService(executor).inspect('C:/work/project/src');

    expect(inspection).toMatchObject({
      repositoryRoot: root,
      branch: 'feature/combined',
      head: { kind: 'branch', name: 'feature/combined', oid: 'abcdef' },
      upstream: 'origin/feature/combined',
      ahead: 3,
      behind: 2,
      filesChanged: 2,
      stagedFiles: 1,
      unstagedFiles: 2,
      additions: 5,
      deletions: 5,
      hasUnknownStatistics: true,
    });
    expect(inspection.files).toMatchObject([
      {
        path: 'notes.txt',
        status: 'untracked',
        statistics: { additions: null, deletions: null, known: false },
      },
      {
        path: 'src/both.ts',
        staged: true,
        unstaged: true,
        statistics: { additions: 5, deletions: 5, known: true },
      },
    ]);
    expect(executor.calls).toHaveLength(4);
    expect(executor.calls.slice(1).every((call) => call.cwd === root)).toBe(true);
  });

  it('maps unborn and detached heads to stable reference types', async () => {
    const inspectHead = async (status: string) => {
      const executor = new FakeGitExecutor((args) =>
        args[0] === 'rev-parse' ? ok('/repo\n') : args[0] === 'status' ? ok(status) : ok(),
      );
      return (await new GitRepositoryService(executor).inspect('/repo')).head;
    };

    await expect(inspectHead('# branch.oid (initial)\0# branch.head main\0')).resolves.toEqual({
      kind: 'unborn',
      name: 'main',
    });
    await expect(inspectHead('# branch.oid deadbeef\0# branch.head (detached)\0')).resolves.toEqual(
      { kind: 'commit', name: 'deadbeef', oid: 'deadbeef' },
    );
  });

  it('reports a non-repository and other Git failures without silent fallback', async () => {
    const notRepository = new FakeGitExecutor(() => ({
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    }));
    const otherFailure = new FakeGitExecutor(() => ({
      exitCode: 129,
      stdout: '',
      stderr: 'unknown option',
    }));

    await expect(
      new GitRepositoryService(notRepository).discoverRoot('/tmp'),
    ).rejects.toMatchObject({
      code: 'NOT_A_GIT_REPOSITORY',
    });
    await expect(new GitRepositoryService(otherFailure).discoverRoot('/tmp')).rejects.toMatchObject(
      {
        code: 'GIT_COMMAND_FAILED',
      },
    );
  });
});

describe('SystemGitCommandExecutor', () => {
  it('reports a missing Git executable explicitly', async () => {
    const executor = new SystemGitCommandExecutor({
      executable: 'definitely-not-a-real-git-executable-for-verifier-tests',
    });

    await expect(executor.execute(['--version'], process.cwd())).rejects.toEqual(
      expect.objectContaining<Partial<RepositoryError>>({
        code: 'GIT_NOT_FOUND',
        message: 'Git executable could not be found.',
      }),
    );
  });
});

describe('real Git inspection', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  it('inspects actual staged, unstaged, and untracked files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verify-repository-'));
    temporaryDirectories.push(root);
    const git = new SystemGitCommandExecutor();
    const run = async (args: readonly string[]) => {
      const result = await git.execute(args, root);
      expect(result.exitCode, `git ${args.join(' ')}`).toBe(0);
    };

    await run(['init', '--initial-branch=main', '--quiet']);
    await writeFile(join(root, 'tracked.txt'), 'one\n', 'utf8');
    await run(['add', 'tracked.txt']);
    await run([
      '-c',
      'user.name=Verifier Test',
      '-c',
      'user.email=verifier@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'initial',
    ]);

    await writeFile(join(root, 'tracked.txt'), 'one\ntwo\n', 'utf8');
    await writeFile(join(root, 'staged.txt'), 'staged\n', 'utf8');
    await writeFile(join(root, 'untracked.txt'), 'untracked\n', 'utf8');
    await run(['add', 'staged.txt']);

    const inspection = await new GitRepositoryService(git).inspect(root);

    expect(inspection.repositoryRoot).toBe(normalize(await realpath(root)));
    expect(inspection.branch).toBe('main');
    expect(inspection.filesChanged).toBe(3);
    expect(inspection.stagedFiles).toBe(1);
    expect(inspection.unstagedFiles).toBe(2);
    expect(inspection.files.find((file) => file.path === 'staged.txt')).toMatchObject({
      status: 'added',
      staged: true,
      unstaged: false,
      statistics: { additions: 1, deletions: 0, known: true },
    });
    expect(inspection.files.find((file) => file.path === 'tracked.txt')).toMatchObject({
      status: 'modified',
      staged: false,
      unstaged: true,
    });
    expect(inspection.files.find((file) => file.path === 'untracked.txt')).toMatchObject({
      status: 'untracked',
      statistics: { additions: null, deletions: null, known: false },
    });
  });
});
