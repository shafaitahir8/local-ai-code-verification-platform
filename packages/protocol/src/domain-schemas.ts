import type {
  Artifact,
  ChangedFile,
  Finding,
  GateResult,
  GitReference,
  LineStatistics,
  RepositoryChange,
  VerificationCheck,
  VerificationCheckResult,
  VerificationRun,
} from '@verify/domain';
import { z } from 'zod';

export const findingSchema: z.ZodType<Finding> = z.strictObject({
  id: z.string().min(1),
  source: z.string().min(1),
  severity: z.enum(['info', 'warning', 'error', 'critical']),
  message: z.string().min(1),
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  ruleId: z.string().min(1).optional(),
});

export const artifactSchema: z.ZodType<Artifact> = z.strictObject({
  type: z.string().min(1),
  path: z.string().min(1),
  source: z.string().min(1),
  name: z.string().min(1).optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]))
    .optional(),
});

export const lineStatisticsSchema: z.ZodType<LineStatistics> = z.strictObject({
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  binary: z.boolean(),
  known: z.boolean(),
});

export const changedFileSchema: z.ZodType<ChangedFile> = z.strictObject({
  path: z.string().min(1),
  originalPath: z.string().min(1).optional(),
  status: z.enum([
    'added',
    'modified',
    'deleted',
    'renamed',
    'copied',
    'type-changed',
    'untracked',
    'conflicted',
    'unknown',
  ]),
  staged: z.boolean(),
  unstaged: z.boolean(),
  stagedStatus: z.enum([
    'unmodified',
    'added',
    'modified',
    'deleted',
    'renamed',
    'copied',
    'type-changed',
    'unmerged',
    'unknown',
  ]),
  unstagedStatus: z.enum([
    'unmodified',
    'added',
    'modified',
    'deleted',
    'renamed',
    'copied',
    'type-changed',
    'unmerged',
    'unknown',
  ]),
  statistics: lineStatisticsSchema,
});

export const gitReferenceSchema: z.ZodType<GitReference> = z.strictObject({
  kind: z.enum(['branch', 'commit', 'unborn']),
  name: z.string(),
  oid: z.string().min(1).optional(),
});

export const repositoryChangeSchema: z.ZodType<RepositoryChange> = z.strictObject({
  repositoryRoot: z.string().min(1),
  branch: z.string().nullable(),
  head: gitReferenceSchema,
  upstream: z.string().min(1).optional(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  filesChanged: z.number().int().nonnegative(),
  stagedFiles: z.number().int().nonnegative(),
  unstagedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hasUnknownStatistics: z.boolean(),
  files: z.array(changedFileSchema),
});

export const verificationCheckSchema: z.ZodType<VerificationCheck> = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  command: z.string().min(1),
  failurePolicy: z.enum(['block', 'warn']),
  timeoutMs: z.number().int().positive().optional(),
});

export const verificationCheckResultSchema: z.ZodType<VerificationCheckResult> = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  status: z.enum(['passed', 'warning', 'failed', 'error', 'cancelled', 'skipped']),
  failurePolicy: z.enum(['block', 'warn']),
  command: z.string().min(1).optional(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  errorSummary: z.string().min(1).optional(),
  findings: z.array(findingSchema),
  artifacts: z.array(artifactSchema),
});

export const gateResultSchema: z.ZodType<GateResult> = z.strictObject({
  status: z.enum(['PASS', 'WARN', 'BLOCK']),
  reasons: z.array(z.string()),
  evaluatedAt: z.iso.datetime(),
  summary: z.strictObject({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
});

export const verificationRunSchema: z.ZodType<VerificationRun> = z.strictObject({
  id: z.string().min(1),
  projectId: z.string().min(1).optional(),
  repositoryRoot: z.string().min(1),
  status: z.enum(['running', 'completed', 'error', 'cancelled']),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  checks: z.array(verificationCheckResultSchema),
  gate: gateResultSchema.optional(),
});
