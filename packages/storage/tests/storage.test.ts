import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Project, VerificationRun } from '@verify/domain';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeRepositoryRoot,
  resolveStorageDatabasePath,
  runStorageMigrations,
  SqliteRunRepository,
  StorageMigrationError,
} from '../src/index.js';

const createdDirectories: string[] = [];
const openRepositories: SqliteRunRepository[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'verify-storage-'));
  createdDirectories.push(directory);
  return directory;
}

function openRepository(databasePath: string): SqliteRunRepository {
  const repository = new SqliteRunRepository({ databasePath });
  openRepositories.push(repository);
  return repository;
}

function sampleRun(
  repositoryRoot: string,
  overrides: Partial<VerificationRun> = {},
): VerificationRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryRoot,
    status: 'completed',
    startedAt: '2026-09-07T08:00:00.000Z',
    completedAt: '2026-09-07T08:00:01.250Z',
    durationMs: 1_250,
    checks: [
      {
        id: 'test',
        name: 'Unit tests',
        type: 'test',
        command: 'npm test',
        failurePolicy: 'block',
        status: 'passed',
        startedAt: '2026-09-07T08:00:00.000Z',
        completedAt: '2026-09-07T08:00:01.250Z',
        durationMs: 1_250,
        exitCode: 0,
        stdout: '12 tests passed\n',
        stderr: '',
        findings: [
          {
            id: 'finding-1',
            source: 'test-runner',
            severity: 'info',
            message: 'All tests passed.',
            file: 'tests/example.test.ts',
            line: 12,
            column: 3,
            ruleId: 'tests-pass',
          },
        ],
        artifacts: [
          {
            type: 'log',
            path: '.verify/artifacts/test.log',
            source: 'generic-command',
            name: 'Test log',
            metadata: { retained: true, bytes: 16, encoding: 'utf8', note: null },
          },
        ],
      },
    ],
    gate: {
      status: 'PASS',
      reasons: [],
      evaluatedAt: '2026-09-07T08:00:01.250Z',
      summary: {
        total: 1,
        passed: 1,
        warning: 0,
        failed: 0,
        error: 0,
        cancelled: 0,
        skipped: 0,
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  while (openRepositories.length > 0) {
    openRepositories.pop()?.close();
  }
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('SqliteRunRepository', () => {
  it('persists complete normalized evidence and reopens it from disk', async () => {
    const directory = temporaryDirectory();
    const repositoryRoot = join(directory, 'project');
    const databasePath = join(directory, 'state', 'history.sqlite3');
    mkdirSync(repositoryRoot);

    const first = openRepository(databasePath);
    const run = sampleRun(repositoryRoot);
    await first.saveRun(run);
    first.close();

    const second = openRepository(databasePath);
    await expect(second.getLatestRun(repositoryRoot)).resolves.toStrictEqual({
      ...run,
      repositoryRoot: normalizeRepositoryRoot(repositoryRoot),
    });
  });

  it('returns repository-scoped history newest first with an explicit limit', async () => {
    const directory = temporaryDirectory();
    const firstRoot = join(directory, 'first');
    const secondRoot = join(directory, 'second');
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    const repository = openRepository(':memory:');

    await repository.saveRun(sampleRun(firstRoot));
    await repository.saveRun(
      sampleRun(firstRoot, {
        id: 'run-2',
        startedAt: '2026-09-07T09:00:00.000Z',
        completedAt: '2026-09-07T09:00:02.000Z',
      }),
    );
    await repository.saveRun(sampleRun(secondRoot, { id: 'other-run', projectId: 'project-2' }));

    const history = await repository.listRuns(firstRoot, 1);
    expect(history).toHaveLength(1);
    expect(history[0]?.id).toBe('run-2');
    await expect(repository.getLatestRun(join(directory, 'missing'))).resolves.toBeNull();
  });

  it('atomically replaces nested results when a run is saved again', async () => {
    const directory = temporaryDirectory();
    const repositoryRoot = join(directory, 'project');
    mkdirSync(repositoryRoot);
    const repository = openRepository(':memory:');

    await repository.saveRun(
      sampleRun(repositoryRoot, {
        status: 'running',
        completedAt: undefined,
        durationMs: undefined,
        checks: [],
        gate: undefined,
      }),
    );
    const completed = sampleRun(repositoryRoot);
    await repository.saveRun(completed);

    const latest = await repository.getLatestRun(repositoryRoot);
    expect(latest?.status).toBe('completed');
    expect(latest?.checks).toHaveLength(1);
    expect(latest?.checks[0]?.findings).toHaveLength(1);
  });

  it('stores project metadata without letting run saves overwrite its name', async () => {
    const directory = temporaryDirectory();
    const repositoryRoot = join(directory, 'project');
    mkdirSync(repositoryRoot);
    const repository = openRepository(':memory:');
    const project: Project = {
      id: 'project-1',
      name: 'Friendly project name',
      repositoryRoot,
      createdAt: '2026-09-01T00:00:00.000Z',
    };

    await repository.saveProject(project);
    await repository.saveRun(sampleRun(repositoryRoot));

    await expect(repository.getProject(repositoryRoot)).resolves.toEqual({
      ...project,
      repositoryRoot: normalizeRepositoryRoot(repositoryRoot),
    });
  });

  it('rejects invalid history limits and access after close', async () => {
    const repository = openRepository(':memory:');
    await expect(repository.listRuns(process.cwd(), 0)).rejects.toThrow(RangeError);
    await expect(repository.listRuns(process.cwd(), 101)).rejects.toThrow(RangeError);

    repository.close();
    await expect(repository.getLatestRun(process.cwd())).rejects.toThrow('closed');
  });
});

describe('storage migrations and paths', () => {
  it('applies the forward migration once and preserves existing data on bootstrap', () => {
    const database = new BetterSqlite3(':memory:');
    const first = runStorageMigrations(database);
    expect(first.applied.map((migration) => migration.version)).toEqual([1]);

    database
      .prepare(
        `INSERT INTO projects (id, name, repository_root, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('existing', 'Existing', '/existing', '2026-01-01', '2026-01-01');

    const second = runStorageMigrations(database);
    expect(second).toMatchObject({ applied: [], currentVersion: 1 });
    expect(database.prepare('SELECT name FROM projects WHERE id = ?').pluck().get('existing')).toBe(
      'Existing',
    );
    database.close();
  });

  it('detects a changed checksum instead of silently accepting migration drift', () => {
    const database = new BetterSqlite3(':memory:');
    runStorageMigrations(database);
    database.prepare('UPDATE __verify_migrations SET checksum = ? WHERE version = 1').run('wrong');
    expect(() => runStorageMigrations(database)).toThrow(StorageMigrationError);
    database.close();
  });

  it('rejects a migration ledger written by an unsupported application version', () => {
    const database = new BetterSqlite3(':memory:');
    runStorageMigrations(database);
    database
      .prepare(
        `INSERT INTO __verify_migrations (version, name, checksum, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(2, 'future', 'future-checksum', '2026-09-07T00:00:00.000Z');

    expect(() => runStorageMigrations(database)).toThrow(/version 2 is not supported/u);
    database.close();
  });

  it('resolves explicit, environment, and default database locations', () => {
    const directory = temporaryDirectory();
    expect(resolveStorageDatabasePath(':memory:')).toBe(':memory:');
    expect(resolveStorageDatabasePath('data/history.db', {}, directory)).toBe(
      join(directory, 'data', 'history.db'),
    );
    expect(
      resolveStorageDatabasePath(undefined, { VERIFY_DATABASE_PATH: 'env.db' }, directory),
    ).toBe(join(directory, 'env.db'));
    expect(() => resolveStorageDatabasePath('', {}, directory)).toThrow(TypeError);
  });
});
