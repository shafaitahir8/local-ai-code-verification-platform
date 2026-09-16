import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    repositoryRoot: text('repository_root').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('projects_repository_root_unique').on(table.repositoryRoot)],
);

export const verificationRuns = sqliteTable(
  'verification_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    repositoryRoot: text('repository_root').notNull(),
    status: text('status', {
      enum: ['running', 'completed', 'error', 'cancelled'],
    }).notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
    durationMs: integer('duration_ms'),
    gateStatus: text('gate_status', { enum: ['PASS', 'WARN', 'BLOCK'] }),
    gateReasonsJson: text('gate_reasons_json'),
    gateEvaluatedAt: text('gate_evaluated_at'),
    gateSummaryJson: text('gate_summary_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('verification_runs_repository_started_idx').on(table.repositoryRoot, table.startedAt),
    index('verification_runs_project_idx').on(table.projectId),
  ],
);

export const checkResults = sqliteTable(
  'check_results',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => verificationRuns.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    status: text('status', {
      enum: ['passed', 'warning', 'failed', 'error', 'cancelled', 'skipped'],
    }).notNull(),
    failurePolicy: text('failure_policy', { enum: ['block', 'warn'] }).notNull(),
    command: text('command'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    exitCode: integer('exit_code'),
    stdout: text('stdout'),
    stderr: text('stderr'),
    errorSummary: text('error_summary'),
  },
  (table) => [
    uniqueIndex('check_results_run_ordinal_unique').on(table.runId, table.ordinal),
    index('check_results_run_idx').on(table.runId),
  ],
);

export const findings = sqliteTable(
  'findings',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    checkResultRowId: integer('check_result_row_id')
      .notNull()
      .references(() => checkResults.rowId, { onDelete: 'cascade', onUpdate: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    id: text('id').notNull(),
    source: text('source').notNull(),
    severity: text('severity', { enum: ['info', 'warning', 'error', 'critical'] }).notNull(),
    message: text('message').notNull(),
    file: text('file'),
    line: integer('line'),
    column: integer('column'),
    ruleId: text('rule_id'),
  },
  (table) => [
    uniqueIndex('findings_check_ordinal_unique').on(table.checkResultRowId, table.ordinal),
    index('findings_check_idx').on(table.checkResultRowId),
  ],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    checkResultRowId: integer('check_result_row_id')
      .notNull()
      .references(() => checkResults.rowId, { onDelete: 'cascade', onUpdate: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    type: text('type').notNull(),
    path: text('path').notNull(),
    source: text('source').notNull(),
    name: text('name'),
    metadataJson: text('metadata_json'),
  },
  (table) => [
    uniqueIndex('artifacts_check_ordinal_unique').on(table.checkResultRowId, table.ordinal),
    index('artifacts_check_idx').on(table.checkResultRowId),
  ],
);

export const approvalReceipts = sqliteTable(
  'approval_receipts',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    repositoryRoot: text('repository_root').notNull(),
    policySchemaVersion: integer('policy_schema_version').notNull(),
    digestVersion: integer('digest_version').notNull(),
    policyDigest: text('policy_digest').notNull(),
    approvedAt: text('approved_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (table) => [
    index('approval_receipts_repository_history_idx').on(table.repositoryRoot, table.rowId),
    uniqueIndex('approval_receipts_active_repository_unique')
      .on(table.repositoryRoot)
      .where(sql`revoked_at IS NULL`),
  ],
);

export const storageSchema = {
  projects,
  verificationRuns,
  checkResults,
  findings,
  artifacts,
  approvalReceipts,
} as const;
