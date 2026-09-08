import { z, type ZodError, type ZodType } from 'zod';

import {
  protocolErrorSchema,
  protocolEventSchema,
  protocolRequestSchema,
  unknownProtocolResultSchema,
  type ProtocolErrorMessage,
  type ProtocolEventMessage,
  type ProtocolRequest,
  type ProtocolResultMessage,
  type ProtocolServerMessage,
  type UnknownProtocolResultMessage,
} from './messages.js';
import { PROTOCOL_VERSION, protocolResultSchemas, type ProtocolMethod } from './methods.js';

export type ProtocolDecodeErrorCode =
  'INVALID_JSON' | 'INVALID_MESSAGE' | 'UNEXPECTED_MESSAGE' | 'LINE_TOO_LONG';

export class ProtocolDecodeError extends Error {
  public constructor(
    public readonly code: ProtocolDecodeErrorCode,
    message: string,
    public readonly lineNumber?: number,
    public readonly validationError?: ZodError,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProtocolDecodeError';
  }
}

function parseJsonLine(line: string): unknown {
  const normalized = line.endsWith('\n') ? line.slice(0, -1).replace(/\r$/, '') : line;
  if (normalized.trim().length === 0) {
    throw new ProtocolDecodeError('INVALID_JSON', 'An NDJSON message cannot be empty.');
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch (error) {
    throw new ProtocolDecodeError(
      'INVALID_JSON',
      'The NDJSON message is not valid JSON.',
      undefined,
      undefined,
      {
        cause: error,
      },
    );
  }
}

function parseWithSchema<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ProtocolDecodeError(
      'INVALID_MESSAGE',
      `The ${label} does not match protocol version ${PROTOCOL_VERSION}.`,
      undefined,
      parsed.error,
    );
  }
  return parsed.data;
}

function line<T>(value: T, schema: ZodType<T>, label: string): string {
  const validated = parseWithSchema(schema, value, label);
  return `${JSON.stringify(validated)}\n`;
}

export function decodeRequestLine(input: string): ProtocolRequest {
  return parseWithSchema(protocolRequestSchema, parseJsonLine(input), 'request');
}

export function encodeRequest<Method extends ProtocolMethod>(
  request: ProtocolRequest<Method>,
): string {
  return line(request as ProtocolRequest, protocolRequestSchema, 'request');
}

export function decodeServerMessageLine(input: string): ProtocolServerMessage {
  const value = parseJsonLine(input);
  const event = protocolEventSchema.safeParse(value);
  if (event.success) {
    return event.data;
  }
  const error = protocolErrorSchema.safeParse(value);
  if (error.success) {
    return error.data;
  }
  const result = unknownProtocolResultSchema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  throw new ProtocolDecodeError(
    'INVALID_MESSAGE',
    `The server message does not match protocol version ${PROTOCOL_VERSION}.`,
    undefined,
    z
      .union([protocolEventSchema, protocolErrorSchema, unknownProtocolResultSchema])
      .safeParse(value).error,
  );
}

export function encodeEvent(event: ProtocolEventMessage): string {
  return line(event, protocolEventSchema, 'event');
}

export function encodeError(error: ProtocolErrorMessage): string {
  return line(error, protocolErrorSchema, 'error');
}

function resultSchema(method: ProtocolMethod): ZodType<unknown> {
  return protocolResultSchemas[method] as ZodType<unknown>;
}

export function encodeResult<Method extends ProtocolMethod>(
  method: Method,
  message: ProtocolResultMessage<Method>,
): string {
  const validatedResult = parseWithSchema(resultSchema(method), message.result, `${method} result`);
  const envelope: UnknownProtocolResultMessage = {
    protocolVersion: PROTOCOL_VERSION,
    id: message.id,
    result: validatedResult as UnknownProtocolResultMessage['result'],
  };
  return line(envelope, unknownProtocolResultSchema, `${method} result envelope`);
}

export function decodeResultLine<Method extends ProtocolMethod>(
  method: Method,
  input: string,
): ProtocolResultMessage<Method> | ProtocolErrorMessage {
  const message = decodeServerMessageLine(input);
  if ('error' in message) {
    return message;
  }
  if ('event' in message) {
    throw new ProtocolDecodeError(
      'UNEXPECTED_MESSAGE',
      `Expected a terminal ${method} result but received event ${message.event}.`,
    );
  }

  const result = parseWithSchema(resultSchema(method), message.result, `${method} result`);
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: message.id,
    result,
  } as ProtocolResultMessage<Method>;
}
