import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';

import type {
  Artifact,
  Finding,
  GateResult,
  Project,
  VerificationCheckResult,
  VerificationRun,
} from '@verify/domain';
import BetterSqlite3 from 'better-sqlite3';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type { ProjectRepository, RunRepository } from './contracts.js';
import { runStorageMigrations } from './migrations/index.js';
import {
  artifacts,
  checkResults,
  findings,
  projects,
  storageSchema,
  verificationRuns,
} from './schema.js';

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

type RunRow = typeof verificationRuns.$inferSelect;
type CheckRow = typeof checkResults.$inferSelect;
type FindingRow = typeof findings.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;

interface ProjectSeed {
  readonly id?: string;
  readonly name: string;
  readonly repositoryRoot: string;
  readonly createdAt?: string;
}

export interface SqliteRunRepositoryOptions {
  /** SQLite filename, `:memory:`, or a path relative to `cwd`. */
  readonly databasePath?: string;
  /** Process environment used to resolve `VERIFY_DATABASE_PATH`. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Working directory used when a configured database path is relative. */
  readonly cwd?: string;
  readonly busyTimeoutMs?: number;
}

export class StorageCorruptionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageCorruptionError';
  }
}

export function resolveStorageDatabasePath(
  configuredPath?: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  cwd = process.cwd(),
): string {
  const candidate = configuredPath ?? environment.VERIFY_DATABASE_PATH;
  if (candidate !== undefined && candidate.trim().length === 0) {
    throw new TypeError('The storage database path cannot be empty.');
  }

  const selected = candidate ?? join(homedir(), '.verify', 'history.sqlite3');
  if (selected === ':memory:') {
    return selected;
  }

  return normalize(isAbsolute(selected) ? selected : resolve(cwd, selected));
}

export function normalizeRepositoryRoot(repositoryRoot: string): string {
  if (repositoryRoot.trim().length === 0) {
    throw new TypeError('The repository root cannot be empty.');
  }

  return normalize(resolve(repositoryRoot));
}

function deterministicProjectId(repositoryRoot: string): string {
  const digest = createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 24);
  return `project_${digest}`;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new StorageCorruptionError(`Stored ${label} is not valid JSON.`, { cause: error });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGateReasons(value: string): string[] {
  const parsed = parseJson(value, 'gate reasons');
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new StorageCorruptionError('Stored gate reasons must be an array of strings.');
  }
  return parsed;
}

function parseGateSummary(value: string): GateResult['summary'] {
  const parsed = parseJson(value, 'gate summary');
  const keys = ['total', 'passed', 'warning', 'failed', 'error', 'cancelled', 'skipped'] as const;

  if (
    !isRecord(parsed) ||
    !keys.every((key) => Number.isInteger(parsed[key]) && Number(parsed[key]) >= 0)
  ) {
    throw new StorageCorruptionError('Stored gate summary has an invalid shape.');
  }

  return {
    total: Number(parsed.total),
    passed: Number(parsed.passed),
    warning: Number(parsed.warning),
    failed: Number(parsed.failed),
    error: Number(parsed.error),
    cancelled: Number(parsed.cancelled),
    skipped: Number(parsed.skipped),
  };
}

function mapGate(row: RunRow): GateResult | undefined {
  const gateParts = [row.gateStatus, row.gateReasonsJson, row.gateEvaluatedAt, row.gateSummaryJson];
  if (gateParts.every((part) => part === null)) {
    return undefined;
  }
  if (gateParts.some((part) => part === null)) {
    throw new StorageCorruptionError(`Run ${row.id} contains a partial gate result.`);
  }

  return {
    status: row.gateStatus!,
    reasons: parseGateReasons(row.gateReasonsJson!),
    evaluatedAt: row.gateEvaluatedAt!,
    summary: parseGateSummary(row.gateSummaryJson!),
  };
}

function mapFinding(row: FindingRow): Finding {
  return {
    id: row.id,
    source: row.source,
    severity: row.severity,
    message: row.message,
    ...(row.file === null ? {} : { file: row.file }),
    ...(row.line === null ? {} : { line: row.line }),
    ...(row.column === null ? {} : { column: row.column }),
    ...(row.ruleId === null ? {} : { ruleId: row.ruleId }),
  };
}

function parseArtifactMetadata(value: string | null): Artifact['metadata'] {
  if (value === null) {
    return undefined;
  }

  const parsed = parseJson(value, 'artifact metadata');
  if (
    !isRecord(parsed) ||
    !Object.values(parsed).every(
      (item) =>
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean',
    )
  ) {
    throw new StorageCorruptionError('Stored artifact metadata has an invalid shape.');
  }
  return parsed as Artifact['metadata'];
}

function mapArtifact(row: ArtifactRow): Artifact {
  const metadata = parseArtifactMetadata(row.metadataJson);
  return {
    type: row.type,
    path: row.path,
    source: row.source,
    ...(row.name === null ? {} : { name: row.name }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function mapCheck(
  row: CheckRow,
  checkFindings: readonly Finding[],
  checkArtifacts: readonly Artifact[],
): VerificationCheckResult {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    failurePolicy: row.failurePolicy,
    ...(row.command === null ? {} : { command: row.command }),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    ...(row.exitCode === null ? {} : { exitCode: row.exitCode }),
    ...(row.stdout === null ? {} : { stdout: row.stdout }),
    ...(row.stderr === null ? {} : { stderr: row.stderr }),
    ...(row.errorSummary === null ? {} : { errorSummary: row.errorSummary }),
    findings: [...checkFindings],
    artifacts: [...checkArtifacts],
  };
}

export class SqliteRunRepository implements RunRepository, ProjectRepository {
  readonly #sqlite: BetterSqlite3.Database;
  readonly #database: BetterSQLite3Database<typeof storageSchema>;
  #closed = false;

  public readonly databasePath: string;

  public constructor(options: SqliteRunRepositoryOptions = {}) {
    this.databasePath = resolveStorageDatabasePath(
      options.databasePath,
      options.environment,
      options.cwd,
    );

    if (this.databasePath !== ':memory:') {
      mkdirSync(dirname(this.databasePath), { recursive: true, mode: 0o700 });
    }

    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new RangeError('busyTimeoutMs must be a non-negative integer.');
    }

    this.#sqlite = new BetterSqlite3(this.databasePath);
    this.#sqlite.pragma('foreign_keys = ON');
    this.#sqlite.pragma(`busy_timeout = ${busyTimeoutMs}`);
    if (this.databasePath !== ':memory:') {
      this.#sqlite.pragma('journal_mode = WAL');
    }

    runStorageMigrations(this.#sqlite);
    this.#database = drizzle(this.#sqlite, { schema: storageSchema });
  }

  public async saveProject(project: Project): Promise<Project> {
    this.#assertOpen();
    return this.#database.transaction(() => this.#upsertProject(project));
  }

  public async getProject(repositoryRoot: string): Promise<Project | null> {
    this.#assertOpen();
    const normalizedRoot = normalizeRepositoryRoot(repositoryRoot);
    const row = this.#database
      .select()
      .from(projects)
      .where(eq(projects.repositoryRoot, normalizedRoot))
      .get();

    return row
      ? {
          id: row.id,
          name: row.name,
          repositoryRoot: row.repositoryRoot,
          createdAt: row.createdAt,
        }
      : null;
  }

  public async saveRun(run: VerificationRun): Promise<VerificationRun> {
    this.#assertOpen();
    const repositoryRoot = normalizeRepositoryRoot(run.repositoryRoot);
    const now = new Date().toISOString();

    return this.#database.transaction(() => {
      const project = this.#ensureProjectForRun(repositoryRoot, run.projectId);

      this.#database
        .insert(verificationRuns)
        .values({
          id: run.id,
          projectId: project.id,
          repositoryRoot,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt ?? null,
          durationMs: run.durationMs ?? null,
          gateStatus: run.gate?.status ?? null,
          gateReasonsJson: run.gate ? JSON.stringify(run.gate.reasons) : null,
          gateEvaluatedAt: run.gate?.evaluatedAt ?? null,
          gateSummaryJson: run.gate ? JSON.stringify(run.gate.summary) : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: verificationRuns.id,
          set: {
            projectId: project.id,
            repositoryRoot,
            status: run.status,
            startedAt: run.startedAt,
            completedAt: run.completedAt ?? null,
            durationMs: run.durationMs ?? null,
            gateStatus: run.gate?.status ?? null,
            gateReasonsJson: run.gate ? JSON.stringify(run.gate.reasons) : null,
            gateEvaluatedAt: run.gate?.evaluatedAt ?? null,
            gateSummaryJson: run.gate ? JSON.stringify(run.gate.summary) : null,
            updatedAt: now,
          },
        })
        .run();

      this.#database.delete(checkResults).where(eq(checkResults.runId, run.id)).run();

      run.checks.forEach((check, ordinal) => {
        const inserted = this.#database
          .insert(checkResults)
          .values({
            runId: run.id,
            ordinal,
            id: check.id,
            name: check.name,
            type: check.type,
            status: check.status,
            failurePolicy: check.failurePolicy,
            command: check.command ?? null,
            startedAt: check.startedAt,
            completedAt: check.completedAt,
            durationMs: check.durationMs,
            exitCode: check.exitCode ?? null,
            stdout: check.stdout ?? null,
            stderr: check.stderr ?? null,
            errorSummary: check.errorSummary ?? null,
          })
          .returning({ rowId: checkResults.rowId })
          .get();

        check.findings.forEach((finding, findingOrdinal) => {
          this.#database
            .insert(findings)
            .values({
              checkResultRowId: inserted.rowId,
              ordinal: findingOrdinal,
              id: finding.id,
              source: finding.source,
              severity: finding.severity,
              message: finding.message,
              file: finding.file ?? null,
              line: finding.line ?? null,
              column: finding.column ?? null,
              ruleId: finding.ruleId ?? null,
            })
            .run();
        });

        check.artifacts.forEach((artifact, artifactOrdinal) => {
          this.#database
            .insert(artifacts)
            .values({
              checkResultRowId: inserted.rowId,
              ordinal: artifactOrdinal,
              type: artifact.type,
              path: artifact.path,
              source: artifact.source,
              name: artifact.name ?? null,
              metadataJson: artifact.metadata ? JSON.stringify(artifact.metadata) : null,
            })
            .run();
        });
      });

      return { ...run, projectId: project.id, repositoryRoot };
    });
  }

  public async getLatestRun(repositoryRoot: string): Promise<VerificationRun | null> {
    this.#assertOpen();
    const normalizedRoot = normalizeRepositoryRoot(repositoryRoot);
    const row = this.#database
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.repositoryRoot, normalizedRoot))
      .orderBy(desc(verificationRuns.startedAt), desc(verificationRuns.updatedAt))
      .limit(1)
      .get();

    if (!row) {
      return null;
    }

    return this.#hydrateRuns([row])[0] ?? null;
  }

  public async listRuns(
    repositoryRoot: string,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<VerificationRun[]> {
    this.#assertOpen();
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
      throw new RangeError(`History limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}.`);
    }

    const normalizedRoot = normalizeRepositoryRoot(repositoryRoot);
    const rows = this.#database
      .select()
      .from(verificationRuns)
      .where(eq(verificationRuns.repositoryRoot, normalizedRoot))
      .orderBy(desc(verificationRuns.startedAt), desc(verificationRuns.updatedAt))
      .limit(limit)
      .all();

    return this.#hydrateRuns(rows);
  }

  public close(): void {
    if (!this.#closed) {
      this.#sqlite.close();
      this.#closed = true;
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error('The SQLite run repository is closed.');
    }
  }

  #upsertProject(project: ProjectSeed): Project {
    const repositoryRoot = normalizeRepositoryRoot(project.repositoryRoot);
    const existing = this.#database
      .select()
      .from(projects)
      .where(eq(projects.repositoryRoot, repositoryRoot))
      .get();
    const now = new Date().toISOString();

    if (existing) {
      this.#database
        .update(projects)
        .set({ name: project.name, updatedAt: now })
        .where(eq(projects.id, existing.id))
        .run();
      return {
        id: existing.id,
        name: project.name,
        repositoryRoot,
        createdAt: existing.createdAt,
      };
    }

    const id = project.id ?? deterministicProjectId(repositoryRoot);
    const createdAt = project.createdAt ?? now;
    this.#database
      .insert(projects)
      .values({ id, name: project.name, repositoryRoot, createdAt, updatedAt: now })
      .run();
    return { id, name: project.name, repositoryRoot, createdAt };
  }

  #ensureProjectForRun(repositoryRoot: string, projectId?: string): Project {
    const existing = this.#database
      .select()
      .from(projects)
      .where(eq(projects.repositoryRoot, repositoryRoot))
      .get();
    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        repositoryRoot: existing.repositoryRoot,
        createdAt: existing.createdAt,
      };
    }

    return this.#upsertProject({
      id: projectId,
      name: basename(repositoryRoot) || repositoryRoot,
      repositoryRoot,
    });
  }

  #hydrateRuns(rows: readonly RunRow[]): VerificationRun[] {
    if (rows.length === 0) {
      return [];
    }

    const runIds = rows.map((row) => row.id);
    const allChecks = this.#database
      .select()
      .from(checkResults)
      .where(inArray(checkResults.runId, runIds))
      .orderBy(asc(checkResults.ordinal))
      .all();
    const checkRowIds = allChecks.map((check) => check.rowId);
    const allFindings =
      checkRowIds.length === 0
        ? []
        : this.#database
            .select()
            .from(findings)
            .where(inArray(findings.checkResultRowId, checkRowIds))
            .orderBy(asc(findings.ordinal))
            .all();
    const allArtifacts =
      checkRowIds.length === 0
        ? []
        : this.#database
            .select()
            .from(artifacts)
            .where(inArray(artifacts.checkResultRowId, checkRowIds))
            .orderBy(asc(artifacts.ordinal))
            .all();

    return rows.map((row) => {
      const runChecks = allChecks
        .filter((check) => check.runId === row.id)
        .map((check) =>
          mapCheck(
            check,
            allFindings
              .filter((finding) => finding.checkResultRowId === check.rowId)
              .map(mapFinding),
            allArtifacts
              .filter((artifact) => artifact.checkResultRowId === check.rowId)
              .map(mapArtifact),
          ),
        );

      const gate = mapGate(row);
      return {
        id: row.id,
        projectId: row.projectId,
        repositoryRoot: row.repositoryRoot,
        status: row.status,
        startedAt: row.startedAt,
        ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
        ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
        checks: runChecks,
        ...(gate === undefined ? {} : { gate }),
      };
    });
  }
}

export function createSqliteRunRepository(
  options: SqliteRunRepositoryOptions = {},
): SqliteRunRepository {
  return new SqliteRunRepository(options);
}
