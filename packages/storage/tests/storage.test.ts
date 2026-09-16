import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ApprovalReceipt, Project, VerificationRun } from '@verify/domain';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeRepositoryRoot,
  resolveStorageDatabasePath,
  runStorageMigrations,
  SqliteRunRepository,
  StorageMigrationError,
} from '../src/index.js';
import { initialMigration } from '../src/migrations/0001-initial.js';

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

function sampleReceipt(
  repositoryRoot: string,
  overrides: Partial<ApprovalReceipt> = {},
): ApprovalReceipt {
  return {
    id: 'receipt-1',
    repositoryRoot: normalizeRepositoryRoot(repositoryRoot),
    policySchemaVersion: 2,
    digestVersion: 1,
    policyDigest: 'a'.repeat(64),
    approvedAt: '2026-09-16T00:00:00.000Z',
    revokedAt: null,
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

describe('local approval receipts', () => {
  it('persists current approval across reopen and scopes it to one repository', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'history.sqlite3');
    const root = join(directory, 'repository');
    const otherRoot = join(directory, 'other');
    const receipt = sampleReceipt(root);
    const first = openRepository(databasePath);

    await expect(first.getLatestApprovalReceipt(root)).resolves.toBeNull();
    await expect(first.approvePolicyReceipt(receipt)).resolves.toEqual(receipt);
    await expect(first.getLatestApprovalReceipt(otherRoot)).resolves.toBeNull();
    first.close();

    const reopened = openRepository(databasePath);
    await expect(reopened.getLatestApprovalReceipt(root)).resolves.toEqual(receipt);
    await expect(reopened.getLatestApprovalReceipt(otherRoot)).resolves.toBeNull();
  });

  it('replaces active approval atomically while retaining historical evidence', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'history.sqlite3');
    const root = join(directory, 'repository');
    const first = sampleReceipt(root);
    const second = sampleReceipt(root, {
      id: 'receipt-2',
      policyDigest: 'b'.repeat(64),
      approvedAt: '2026-09-16T01:00:00.000Z',
    });
    const repository = openRepository(databasePath);

    await repository.approvePolicyReceipt(first);
    await repository.approvePolicyReceipt(second);
    await expect(repository.getLatestApprovalReceipt(root)).resolves.toEqual(second);

    const database = new BetterSqlite3(databasePath);
    const history = database
      .prepare('SELECT id, revoked_at FROM approval_receipts ORDER BY row_id')
      .all() as { id: string; revoked_at: string | null }[];
    expect(history).toEqual([
      { id: first.id, revoked_at: second.approvedAt },
      { id: second.id, revoked_at: null },
    ]);
    database.close();

    await expect(
      repository.approvePolicyReceipt(
        sampleReceipt(root, { id: first.id, policyDigest: 'c'.repeat(64) }),
      ),
    ).rejects.toThrow();
    await expect(repository.getLatestApprovalReceipt(root)).resolves.toEqual(second);
  });

  it('revokes without erasing history and returns the latest revoked receipt on repeat', async () => {
    const repository = openRepository(':memory:');
    const root = join(temporaryDirectory(), 'repository');
    const receipt = sampleReceipt(root);
    const revokedAt = '2026-09-16T02:00:00.000Z';

    await expect(repository.revokeActiveApprovalReceipt(root, revokedAt)).resolves.toBeNull();
    await repository.approvePolicyReceipt(receipt);
    const revoked = { ...receipt, revokedAt };
    await expect(repository.revokeActiveApprovalReceipt(root, revokedAt)).resolves.toEqual(revoked);
    await expect(repository.revokeActiveApprovalReceipt(root, revokedAt)).resolves.toEqual(revoked);
    await expect(repository.getLatestApprovalReceipt(root)).resolves.toEqual(revoked);
  });

  it('rejects malformed receipt inputs and corrupted persisted receipts', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'history.sqlite3');
    const root = join(directory, 'repository');
    const repository = openRepository(databasePath);
    await expect(
      repository.approvePolicyReceipt(sampleReceipt(root, { policyDigest: 'bad' })),
    ).rejects.toThrow(TypeError);
    await expect(repository.getLatestApprovalReceipt(root)).resolves.toBeNull();
    const receipt = sampleReceipt(root);
    await repository.approvePolicyReceipt(receipt);
    const database = new BetterSqlite3(databasePath);
    database
      .prepare('UPDATE approval_receipts SET policy_digest = ? WHERE id = ?')
      .run('bad', receipt.id);
    database.close();
    await expect(repository.getLatestApprovalReceipt(root)).rejects.toThrow('invalid shape');
  });
});

describe('storage migrations and paths', () => {
  it('applies both forward migrations once and preserves existing data on bootstrap', () => {
    const database = new BetterSqlite3(':memory:');
    const first = runStorageMigrations(database);
    expect(first.applied.map((migration) => migration.version)).toEqual([1, 2]);

    database
      .prepare(
        `INSERT INTO projects (id, name, repository_root, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('existing', 'Existing', '/existing', '2026-01-01', '2026-01-01');

    const second = runStorageMigrations(database);
    expect(second).toMatchObject({ applied: [], currentVersion: 2 });
    expect(database.prepare('SELECT name FROM projects WHERE id = ?').pluck().get('existing')).toBe(
      'Existing',
    );
    database.close();
  });

  it('upgrades a populated version-1 database without changing run history', () => {
    const database = new BetterSqlite3(':memory:');
    database.exec(initialMigration.sql);
    database.exec(`CREATE TABLE __verify_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    database
      .prepare(`INSERT INTO __verify_migrations VALUES (?, ?, ?, ?)`)
      .run(
        1,
        initialMigration.name,
        createHash('sha256').update(initialMigration.sql).digest('hex'),
        '2026-09-07T00:00:00.000Z',
      );
    database
      .prepare(
        `INSERT INTO projects (id, name, repository_root, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run('existing', 'Existing', '/existing', '2026-01-01', '2026-01-01');
    database
      .prepare(
        `INSERT INTO verification_runs
       (id, project_id, repository_root, status, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('old-run', 'existing', '/existing', 'running', '2026-01-01', '2026-01-01', '2026-01-01');

    const result = runStorageMigrations(database);
    expect(result).toMatchObject({ currentVersion: 2 });
    expect(result.applied.map((migration) => migration.version)).toEqual([2]);
    expect(database.prepare('SELECT id FROM verification_runs').pluck().all()).toEqual(['old-run']);
    expect(database.prepare('SELECT COUNT(*) FROM approval_receipts').pluck().get()).toBe(0);
    database.close();
  });

  it('detects a changed checksum instead of silently accepting migration drift', () => {
    const database = new BetterSqlite3(':memory:');
    runStorageMigrations(database);
    database.prepare('UPDATE __verify_migrations SET checksum = ? WHERE version = 1').run('wrong');
    expect(() => runStorageMigrations(database)).toThrow(StorageMigrationError);
    database.close();
  });

  it('detects checksum drift for the new approval migration', () => {
    const database = new BetterSqlite3(':memory:');
    runStorageMigrations(database);
    database.prepare('UPDATE __verify_migrations SET checksum = ? WHERE version = 2').run('wrong');
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
      .run(3, 'future', 'future-checksum', '2026-09-07T00:00:00.000Z');

    expect(() => runStorageMigrations(database)).toThrow(/version 3 is not supported/u);
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
