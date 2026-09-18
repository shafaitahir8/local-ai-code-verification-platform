import type { ApprovalReceipt, ExecutablePolicyReview, PolicyApprovalStatus } from '@verify/domain';
import { z } from 'zod';

import {
  gateResultSchema,
  projectProfileResultSchema,
  repositoryChangeSchema,
  verificationPlanPreviewResultSchema,
  verificationRunSchema,
} from './domain-schemas.js';

export const PROTOCOL_VERSION = 1 as const;

const repositoryParamsSchema = z.strictObject({
  repository: z.string().min(1),
});

const requestIdSchema = z.string().min(1).max(256);
const configDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const approvalReceiptSchema: z.ZodType<ApprovalReceipt> = z.strictObject({
  id: z.string().min(1),
  repositoryRoot: z.string().min(1),
  policySchemaVersion: z.literal(2),
  digestVersion: z.literal(1),
  policyDigest: configDigestSchema,
  approvedAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});

export const executablePolicyReviewSchema: z.ZodType<ExecutablePolicyReview> = z.strictObject({
  digestVersion: z.literal(1),
  policySchemaVersion: z.literal(2),
  suites: z.array(
    z.strictObject({
      id: z.string().min(1),
      type: z.string().min(1),
      command: z.string().min(1),
      failurePolicy: z.enum(['block', 'warn']),
      timeoutMs: z.number().int().positive().nullable(),
    }),
  ),
  plans: z.strictObject({
    quick: z.array(z.string().min(1)),
    full: z.array(z.string().min(1)),
  }),
  launchTargets: z.strictObject({}),
  overrides: z.strictObject({}),
});

export const policyApprovalStatusSchema: z.ZodType<PolicyApprovalStatus> = z
  .strictObject({
    repositoryRoot: z.string().min(1),
    policyPath: z.string().min(1),
    policyExists: z.boolean(),
    policyVersion: z.union([z.literal(1), z.literal(2)]).nullable(),
    policyDigest: configDigestSchema.nullable(),
    review: executablePolicyReviewSchema.nullable(),
    status: z.enum([
      'policy-missing',
      'policy-invalid',
      'migration-required',
      'not-approved',
      'approved',
      'outdated',
      'revoked',
    ]),
    receipt: approvalReceiptSchema.nullable(),
  })
  .superRefine((value, context) => {
    const invalid = (): void => {
      context.addIssue({
        code: 'custom',
        message: 'Approval status is inconsistent with policy or receipt state.',
      });
    };
    const receipt = value.receipt;
    if (receipt !== null && receipt.repositoryRoot !== value.repositoryRoot) return invalid();
    if (
      value.status !== 'policy-missing' &&
      value.status !== 'policy-invalid' &&
      value.status !== 'migration-required' &&
      value.review === null
    )
      return invalid();
    switch (value.status) {
      case 'policy-missing':
        if (
          value.policyExists ||
          value.policyVersion !== null ||
          value.policyDigest !== null ||
          value.review !== null
        )
          invalid();
        return;
      case 'policy-invalid':
        if (
          !value.policyExists ||
          value.policyVersion !== null ||
          value.policyDigest !== null ||
          value.review !== null
        )
          invalid();
        return;
      case 'migration-required':
        if (
          !value.policyExists ||
          value.policyVersion !== 1 ||
          value.policyDigest !== null ||
          value.review !== null
        )
          invalid();
        return;
      case 'not-approved':
        if (
          !value.policyExists ||
          value.policyVersion !== 2 ||
          value.policyDigest === null ||
          receipt !== null
        )
          invalid();
        return;
      case 'approved':
        if (
          !value.policyExists ||
          value.policyVersion !== 2 ||
          value.policyDigest === null ||
          receipt === null ||
          receipt.revokedAt !== null ||
          receipt.policyDigest !== value.policyDigest
        )
          invalid();
        return;
      case 'outdated':
        if (
          !value.policyExists ||
          value.policyVersion !== 2 ||
          value.policyDigest === null ||
          receipt === null ||
          receipt.revokedAt !== null ||
          receipt.policyDigest === value.policyDigest
        )
          invalid();
        return;
      case 'revoked':
        if (
          !value.policyExists ||
          value.policyVersion !== 2 ||
          value.policyDigest === null ||
          receipt === null ||
          receipt.revokedAt === null
        )
          invalid();
    }
  });

const failurePolicySchema = z.enum(['block', 'warn']);

const suiteConfigSchema = z.strictObject({
  type: z.string().min(1),
  command: z.string().min(1),
  failure_policy: failurePolicySchema,
  timeout_ms: z.number().int().positive().optional(),
});

export const projectConfigSchema = z.strictObject({
  version: z.literal(1),
  project: z.strictObject({ name: z.string().min(1) }),
  suites: z.record(z.string().min(1), suiteConfigSchema),
});

export const projectConfigV2Schema = z.strictObject({
  version: z.literal(2),
  project: z.strictObject({ name: z.string().min(1) }),
  suites: z.record(z.string().min(1), suiteConfigSchema),
  plans: z.strictObject({
    quick: z.strictObject({ suites: z.array(z.string().min(1)) }),
    full: z.strictObject({ suites: z.array(z.string().min(1)) }),
  }),
  launch_targets: z.strictObject({}),
  discovery: z.strictObject({ exclusions: z.array(z.never()) }),
  overrides: z.strictObject({}),
});

export const projectPolicyResultSchema = z.strictObject({
  repositoryRoot: z.string().min(1),
  path: z.string().min(1),
  exists: z.boolean(),
  config: z.union([projectConfigSchema, projectConfigV2Schema]).optional(),
});

export const projectConfigMigrationPreviewSchema = z.strictObject({
  path: z.string().min(1),
  sourceVersion: z.literal(1),
  targetVersion: z.literal(2),
  sourceDigest: configDigestSchema,
  targetDigest: configDigestSchema,
  targetYaml: z.string().min(1),
  diff: z.string().min(1),
  summary: z.string().min(1),
});

export const projectConfigMigrationApplySchema = z.strictObject({
  path: z.string().min(1),
  version: z.literal(2),
  sourceDigest: configDigestSchema,
  targetDigest: configDigestSchema,
  config: projectConfigV2Schema,
});

export const projectDiscoveryResultSchema = z.strictObject({
  repositoryRoot: z.string().min(1),
  projectName: z.string().min(1),
  projectTypes: z.array(z.enum(['node', 'python', 'typescript', 'vite'])),
  markers: z.array(z.string().min(1)),
  node: z
    .strictObject({
      packageManager: z.enum(['pnpm', 'npm', 'yarn']).nullable(),
      packageName: z.string().nullable(),
      scripts: z.record(z.string(), z.string()),
    })
    .nullable(),
  python: z.strictObject({ pytestDetected: z.boolean() }).nullable(),
  suggestedSuites: z.array(
    suiteConfigSchema.extend({
      id: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  warnings: z.array(z.string()),
});

export const protocolParamsSchemas = {
  'project.discover': repositoryParamsSchema,
  'project.profile': repositoryParamsSchema,
  'verification.plan': repositoryParamsSchema,
  'config.get': repositoryParamsSchema,
  'config.init': repositoryParamsSchema.extend({ force: z.boolean().optional() }),
  'config.policy.get': repositoryParamsSchema,
  'config.migrate.preview': repositoryParamsSchema,
  'config.migrate.apply': repositoryParamsSchema.extend({
    expectedSourceDigest: configDigestSchema,
    expectedTargetDigest: configDigestSchema,
  }),
  'config.approval.status': repositoryParamsSchema,
  'config.approval.approve': repositoryParamsSchema.extend({
    expectedPolicyDigest: configDigestSchema,
  }),
  'config.approval.revoke': repositoryParamsSchema,
  'repository.inspect': repositoryParamsSchema,
  'verification.run': repositoryParamsSchema,
  'verification.plan.run': repositoryParamsSchema.extend({ mode: z.enum(['quick', 'full']) }),
  'verification.cancel': z.strictObject({ targetRequestId: requestIdSchema }),
  'operation.cancel': z.strictObject({ targetRequestId: requestIdSchema }),
  'gate.latest': repositoryParamsSchema,
  'runs.list': repositoryParamsSchema.extend({
    limit: z.number().int().min(1).max(100).optional(),
  }),
} as const;

export const protocolResultSchemas = {
  'project.discover': projectDiscoveryResultSchema,
  'project.profile': projectProfileResultSchema,
  'verification.plan': verificationPlanPreviewResultSchema,
  'config.get': z.strictObject({
    exists: z.boolean(),
    path: z.string().min(1),
    config: projectConfigSchema.optional(),
  }),
  'config.init': z.strictObject({
    path: z.string().min(1),
    config: projectConfigSchema,
    discovery: projectDiscoveryResultSchema.optional(),
    overwritten: z.boolean(),
  }),
  'config.policy.get': projectPolicyResultSchema,
  'config.migrate.preview': projectConfigMigrationPreviewSchema,
  'config.migrate.apply': projectConfigMigrationApplySchema,
  'config.approval.status': policyApprovalStatusSchema,
  'config.approval.approve': policyApprovalStatusSchema,
  'config.approval.revoke': policyApprovalStatusSchema,
  'repository.inspect': repositoryChangeSchema,
  'verification.run': verificationRunSchema,
  'verification.plan.run': verificationRunSchema,
  'verification.cancel': z.strictObject({ accepted: z.boolean() }),
  'operation.cancel': z.strictObject({ accepted: z.boolean() }),
  'gate.latest': z
    .strictObject({
      runId: z.string().min(1),
      gate: gateResultSchema,
    })
    .nullable(),
  'runs.list': z.strictObject({ runs: z.array(verificationRunSchema) }),
} as const;

export type ProtocolMethod = keyof typeof protocolParamsSchemas;

export type ProtocolParamsMap = {
  readonly [Method in ProtocolMethod]: z.infer<(typeof protocolParamsSchemas)[Method]>;
};

export type ProtocolResultMap = {
  readonly [Method in ProtocolMethod]: z.infer<(typeof protocolResultSchemas)[Method]>;
};

export type ProjectConfigMessage = z.infer<typeof projectConfigSchema>;
export type ProjectConfigV2Message = z.infer<typeof projectConfigV2Schema>;
export type ProjectDiscoveryResult = z.infer<typeof projectDiscoveryResultSchema>;
export type RepositoryInspectionResult = z.infer<typeof repositoryChangeSchema>;
