import { z } from 'zod';

import {
  verificationCheckResultSchema,
  verificationCheckSchema,
  verificationRunSchema,
  projectProfileProgressSchema,
} from './domain-schemas.js';
import {
  PROTOCOL_VERSION,
  protocolParamsSchemas,
  type ProtocolMethod,
  type ProtocolParamsMap,
  type ProtocolResultMap,
} from './methods.js';

const requestIdSchema = z.string().min(1).max(256);

function requestSchema<Method extends ProtocolMethod>(method: Method) {
  return z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    id: requestIdSchema,
    method: z.literal(method),
    params: protocolParamsSchemas[method],
  });
}

export const protocolRequestSchema = z.discriminatedUnion('method', [
  requestSchema('project.discover'),
  requestSchema('project.profile'),
  requestSchema('verification.plan'),
  requestSchema('config.get'),
  requestSchema('config.init'),
  requestSchema('config.policy.get'),
  requestSchema('config.migrate.preview'),
  requestSchema('config.migrate.apply'),
  requestSchema('repository.inspect'),
  requestSchema('verification.run'),
  requestSchema('verification.cancel'),
  requestSchema('operation.cancel'),
  requestSchema('gate.latest'),
  requestSchema('runs.list'),
]);

export type ProtocolRequest<Method extends ProtocolMethod = ProtocolMethod> = {
  readonly [Key in Method]: {
    readonly protocolVersion: typeof PROTOCOL_VERSION;
    readonly id: string;
    readonly method: Key;
    readonly params: ProtocolParamsMap[Key];
  };
}[Method];

export const protocolEventSchema = z.discriminatedUnion('event', [
  z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    id: requestIdSchema,
    event: z.literal('profile.progress'),
    data: projectProfileProgressSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    id: requestIdSchema,
    event: z.literal('check.started'),
    data: z.strictObject({
      runId: z.string().min(1),
      check: verificationCheckSchema,
      startedAt: z.iso.datetime(),
    }),
  }),
  z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    id: requestIdSchema,
    event: z.literal('check.output'),
    data: z.strictObject({
      runId: z.string().min(1),
      checkId: z.string().min(1),
      stream: z.enum(['stdout', 'stderr']),
      chunk: z.string(),
      timestamp: z.iso.datetime(),
    }),
  }),
  z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    id: requestIdSchema,
    event: z.literal('check.completed'),
    data: z.strictObject({
      runId: z.string().min(1),
      result: verificationCheckResultSchema,
    }),
  }),
  z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    id: requestIdSchema,
    event: z.literal('run.completed'),
    data: z.strictObject({ run: verificationRunSchema }),
  }),
]);

export type ProtocolEventMessage = z.infer<typeof protocolEventSchema>;
export type ProtocolEventName = ProtocolEventMessage['event'];

export const protocolErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'METHOD_NOT_FOUND',
  'INVALID_PARAMS',
  'NOT_FOUND',
  'CONFIG_ERROR',
  'MIGRATION_STALE',
  'EXECUTION_ERROR',
  'INTERRUPTED',
  'INTERNAL_ERROR',
]);

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const protocolErrorSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: requestIdSchema.nullable(),
  error: z.strictObject({
    code: protocolErrorCodeSchema,
    message: z.string().min(1),
    details: jsonValueSchema.optional(),
  }),
});

export type ProtocolErrorMessage = z.infer<typeof protocolErrorSchema>;
export type ProtocolErrorCode = z.infer<typeof protocolErrorCodeSchema>;

export const unknownProtocolResultSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: requestIdSchema,
  result: jsonValueSchema,
});

export interface UnknownProtocolResultMessage {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly id: string;
  readonly result: JsonValue;
}

export type ProtocolResultMessage<Method extends ProtocolMethod = ProtocolMethod> = {
  readonly [Key in Method]: {
    readonly protocolVersion: typeof PROTOCOL_VERSION;
    readonly id: string;
    readonly result: ProtocolResultMap[Key];
  };
}[Method];

export type ProtocolServerMessage =
  ProtocolEventMessage | ProtocolErrorMessage | UnknownProtocolResultMessage;
