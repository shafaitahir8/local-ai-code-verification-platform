import type {
  Artifact,
  ChangedFile,
  Finding,
  GateResult,
  GitReference,
  LineStatistics,
  ProjectCapability,
  ProjectEvidence,
  ProjectProfile,
  ProjectProfileAmbiguity,
  ProjectProfileProgress,
  ProjectProfileResult,
  ProjectProfileWarning,
  ProjectScanStatistics,
  ProjectTaskCandidate,
  ProjectWorkspaceUnit,
  RepositoryChange,
  VerificationCheck,
  VerificationCheckResult,
  VerificationPlan,
  VerificationPlanCheckDecision,
  VerificationPlanPreview,
  VerificationPlanPreviewResult,
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

export const projectEvidenceSchema: z.ZodType<ProjectEvidence> = z.strictObject({
  id: z.string().min(1),
  sensorId: z.string().min(1),
  kind: z.enum(['manifest', 'config', 'lockfile', 'script', 'path', 'convention']),
  path: z.string().min(1),
  pointer: z.array(z.string().min(1)).optional(),
  summary: z.string().min(1),
});

export const projectCapabilitySchema: z.ZodType<ProjectCapability> = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    'language',
    'framework',
    'package-manager',
    'workspace-system',
    'test-framework',
    'build-tool',
    'linter',
    'typechecker',
    'runtime',
    'preview',
  ]),
  name: z.string().min(1),
  confidence: z.enum(['confirmed', 'strong', 'tentative']),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const projectWorkspaceUnitSchema: z.ZodType<ProjectWorkspaceUnit> = z.strictObject({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const projectTaskCandidateSchema: z.ZodType<ProjectTaskCandidate> = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['test', 'build', 'lint', 'typecheck', 'run', 'preview']),
  label: z.string().min(1),
  command: z.string().min(1),
  workingDirectory: z.string().min(1),
  workspaceId: z.string().min(1).optional(),
  confidence: z.enum(['confirmed', 'strong', 'tentative']),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const projectProfileAmbiguitySchema: z.ZodType<ProjectProfileAmbiguity> = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  candidateIds: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const projectProfileWarningSchema: z.ZodType<ProjectProfileWarning> = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  sensorId: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  affectsCompleteness: z.boolean(),
});

export const projectScanStatisticsSchema: z.ZodType<ProjectScanStatistics> = z.strictObject({
  entriesScanned: z.number().int().nonnegative(),
  filesScanned: z.number().int().nonnegative(),
  directoriesScanned: z.number().int().nonnegative(),
  bytesRead: z.number().int().nonnegative(),
  skippedDirectories: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  limitsReached: z.array(z.enum(['entries', 'file-bytes', 'aggregate-bytes', 'elapsed-time'])),
});

export const projectProfileSchema: z.ZodType<ProjectProfile> = z.strictObject({
  profileVersion: z.literal(1),
  repositoryRoot: z.string().min(1),
  displayName: z.string().min(1),
  generatedAt: z.iso.datetime(),
  completeness: z.enum(['complete', 'partial']),
  scan: projectScanStatisticsSchema,
  capabilities: z.array(projectCapabilitySchema),
  workspaceUnits: z.array(projectWorkspaceUnitSchema),
  taskCandidates: z.array(projectTaskCandidateSchema),
  evidence: z.array(projectEvidenceSchema),
  ambiguities: z.array(projectProfileAmbiguitySchema),
  warnings: z.array(projectProfileWarningSchema),
});

export const projectProfileProgressSchema: z.ZodType<ProjectProfileProgress> = z.strictObject({
  phase: z.enum(['inventory', 'sensors', 'finalizing']),
  message: z.string().min(1),
  entriesScanned: z.number().int().nonnegative(),
  bytesRead: z.number().int().nonnegative(),
  sensorsCompleted: z.number().int().nonnegative(),
  sensorCount: z.number().int().nonnegative(),
});

export const projectProfileResultSchema: z.ZodType<ProjectProfileResult> = z.discriminatedUnion(
  'status',
  [
    z.strictObject({ status: z.literal('completed'), profile: projectProfileSchema }),
    z.strictObject({ status: z.literal('cancelled') }),
  ],
);

export const verificationPlanCheckDecisionSchema: z.ZodType<VerificationPlanCheckDecision> =
  z.strictObject({
    taskCandidateId: z.string().min(1),
    kind: z.enum(['test', 'lint', 'typecheck', 'build']),
    label: z.string().min(1),
    command: z.string().min(1),
    workingDirectory: z.string().min(1),
    workspaceId: z.string().min(1).optional(),
    confidence: z.enum(['confirmed', 'strong', 'tentative']),
    capabilityIds: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    reason: z.string().min(1),
  });

const verificationPlanObjectSchema = z.strictObject({
  planVersion: z.literal(1),
  mode: z.enum(['quick', 'full']),
  status: z.enum(['ready', 'unavailable']),
  statusReason: z.string().min(1),
  repositoryRoot: z.string().min(1),
  profileVersion: z.literal(1),
  profileGeneratedAt: z.iso.datetime(),
  profileCompleteness: z.enum(['complete', 'partial']),
  recommendationSource: z.literal('deterministic-project-profile'),
  selectedChecks: z.array(verificationPlanCheckDecisionSchema),
  skippedChecks: z.array(verificationPlanCheckDecisionSchema),
});

export const verificationPlanSchema: z.ZodType<VerificationPlan> = verificationPlanObjectSchema;

const quickVerificationPlanSchema: z.ZodType<VerificationPlan<'quick'>> =
  verificationPlanObjectSchema.extend({ mode: z.literal('quick') });
const fullVerificationPlanSchema: z.ZodType<VerificationPlan<'full'>> =
  verificationPlanObjectSchema.extend({ mode: z.literal('full') });

const verificationPlanPreviewObjectSchema = z.strictObject({
  profile: projectProfileSchema,
  plans: z.strictObject({
    quick: quickVerificationPlanSchema,
    full: fullVerificationPlanSchema,
  }),
});

export const verificationPlanPreviewSchema: z.ZodType<VerificationPlanPreview> =
  verificationPlanPreviewObjectSchema.superRefine((preview, context) => {
    const profile = preview.profile;
    for (const [field, items] of [
      ['evidence', profile.evidence],
      ['capabilities', profile.capabilities],
      ['workspaceUnits', profile.workspaceUnits],
      ['taskCandidates', profile.taskCandidates],
    ] as const) {
      const ids = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (ids.has(item.id)) {
          context.addIssue({
            code: 'custom',
            path: ['profile', field, index, 'id'],
            message: `Project profile ${field} contains duplicate ID ${item.id}.`,
          });
        }
        ids.add(item.id);
      }
    }

    const evidenceIds = new Set(profile.evidence.map((item) => item.id));
    const candidates = new Map(profile.taskCandidates.map((item) => [item.id, item]));
    const capabilities = new Map(profile.capabilities.map((item) => [item.id, item]));
    const capabilityKindByCheck = {
      test: 'test-framework',
      lint: 'linter',
      typecheck: 'typechecker',
      build: 'build-tool',
    } as const;

    for (const mode of ['quick', 'full'] as const) {
      const plan = preview.plans[mode];
      for (const [field, expected] of [
        ['repositoryRoot', preview.profile.repositoryRoot],
        ['profileVersion', preview.profile.profileVersion],
        ['profileGeneratedAt', preview.profile.generatedAt],
        ['profileCompleteness', preview.profile.completeness],
      ] as const) {
        if (plan[field] === expected) continue;
        context.addIssue({
          code: 'custom',
          path: ['plans', mode, field],
          message: `${mode} plan ${field} must match the embedded project profile.`,
        });
      }

      const seenCandidateIds = new Set<string>();
      for (const group of ['selectedChecks', 'skippedChecks'] as const) {
        for (const [index, decision] of plan[group].entries()) {
          const path = ['plans', mode, group, index] as const;
          if (seenCandidateIds.has(decision.taskCandidateId)) {
            context.addIssue({
              code: 'custom',
              path: [...path, 'taskCandidateId'],
              message: 'A task candidate may appear only once in each plan.',
            });
          }
          seenCandidateIds.add(decision.taskCandidateId);

          const candidate = candidates.get(decision.taskCandidateId);
          if (candidate === undefined) {
            context.addIssue({
              code: 'custom',
              path: [...path, 'taskCandidateId'],
              message: 'Plan decision must reference an observed project task candidate.',
            });
          } else {
            for (const field of [
              'kind',
              'label',
              'command',
              'workingDirectory',
              'workspaceId',
              'confidence',
            ] as const) {
              if (decision[field] === candidate[field]) continue;
              context.addIssue({
                code: 'custom',
                path: [...path, field],
                message: `Plan decision ${field} must match its observed task candidate.`,
              });
            }
            if (
              group === 'selectedChecks' &&
              candidate.evidenceIds.some((id) => !evidenceIds.has(id))
            ) {
              context.addIssue({
                code: 'custom',
                path: [...path, 'taskCandidateId'],
                message: 'A selected check requires all observed task evidence to resolve.',
              });
            }
          }

          if (decision.evidenceIds.length === 0) {
            context.addIssue({
              code: 'custom',
              path: [...path, 'evidenceIds'],
              message: 'Plan decision must retain at least one resolvable source evidence ID.',
            });
          }
          const seenDecisionEvidenceIds = new Set<string>();
          for (const [evidenceIndex, id] of decision.evidenceIds.entries()) {
            if (
              seenDecisionEvidenceIds.has(id) ||
              !evidenceIds.has(id) ||
              (candidate !== undefined && !candidate.evidenceIds.includes(id))
            ) {
              context.addIssue({
                code: 'custom',
                path: [...path, 'evidenceIds', evidenceIndex],
                message: 'Plan evidence ID must uniquely resolve to evidence on its source task.',
              });
            }
            seenDecisionEvidenceIds.add(id);
          }

          const seenCapabilityIds = new Set<string>();
          for (const [capabilityIndex, id] of decision.capabilityIds.entries()) {
            const capability = capabilities.get(id);
            if (
              seenCapabilityIds.has(id) ||
              capability === undefined ||
              capability.kind !== capabilityKindByCheck[decision.kind] ||
              capability.confidence !== 'confirmed' ||
              capability.evidenceIds.length === 0 ||
              capability.evidenceIds.some((item) => !evidenceIds.has(item))
            ) {
              context.addIssue({
                code: 'custom',
                path: [...path, 'capabilityIds', capabilityIndex],
                message:
                  'Plan capability ID must uniquely resolve to a confirmed matching capability with valid evidence.',
              });
            }
            seenCapabilityIds.add(id);
          }
          if (group === 'selectedChecks' && decision.capabilityIds.length === 0) {
            context.addIssue({
              code: 'custom',
              path: [...path, 'capabilityIds'],
              message: 'A selected check requires confirmed matching capability evidence.',
            });
          }
        }
      }
    }
  });

export const verificationPlanPreviewResultSchema: z.ZodType<VerificationPlanPreviewResult> =
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('completed'), preview: verificationPlanPreviewSchema }),
    z.strictObject({ status: z.literal('cancelled') }),
  ]);

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
