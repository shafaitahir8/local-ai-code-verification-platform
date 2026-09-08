import { z } from 'zod';

import {
  gateResultSchema,
  repositoryChangeSchema,
  verificationRunSchema,
} from './domain-schemas.js';

export const PROTOCOL_VERSION = 1 as const;

const repositoryParamsSchema = z.strictObject({
  repository: z.string().min(1),
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
  'config.get': repositoryParamsSchema,
  'config.init': repositoryParamsSchema.extend({ force: z.boolean().optional() }),
  'repository.inspect': repositoryParamsSchema,
  'verification.run': repositoryParamsSchema,
  'gate.latest': repositoryParamsSchema,
  'runs.list': repositoryParamsSchema.extend({
    limit: z.number().int().min(1).max(100).optional(),
  }),
} as const;

export const protocolResultSchemas = {
  'project.discover': projectDiscoveryResultSchema,
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
  'repository.inspect': repositoryChangeSchema,
  'verification.run': verificationRunSchema,
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
export type ProjectDiscoveryResult = z.infer<typeof projectDiscoveryResultSchema>;
export type RepositoryInspectionResult = z.infer<typeof repositoryChangeSchema>;
