import { createInterface } from 'node:readline';

import { NoVerificationRunError, type VerifierApplication } from '@verify/core';
import {
  ConfigAlreadyExistsError,
  ConfigNotFoundError,
  ConfigUnsafePathError,
  ConfigValidationError,
} from '@verify/config';
import {
  decodeRequestLine,
  encodeError,
  encodeEvent,
  encodeResult,
  PROTOCOL_VERSION,
  ProtocolDecodeError,
  protocolResultSchemas,
  type ProtocolErrorCode,
  type ProtocolRequest,
} from '@verify/protocol';

import { formatError } from './format.js';
import type { CliIo } from './program.js';

interface ProtocolWriter {
  write(value: string): void;
  diagnostic(value: string): void;
}

export async function serveProtocol(application: VerifierApplication, io: CliIo): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  const writer: ProtocolWriter = {
    write: (value) => io.writeOut(value),
    diagnostic: (value) => io.writeError(value),
  };

  for await (const line of input) {
    if (line.trim().length === 0) continue;
    let request: ProtocolRequest;
    try {
      request = decodeRequestLine(line);
    } catch (error) {
      writer.write(encodeProtocolError(null, 'INVALID_REQUEST', formatError(error)));
      continue;
    }
    await handleProtocolRequest(application, request, writer);
  }
}

export async function handleProtocolRequest(
  application: VerifierApplication,
  request: ProtocolRequest,
  writer: ProtocolWriter,
): Promise<void> {
  try {
    switch (request.method) {
      case 'project.discover': {
        const result = await application.discover(request.params.repository);
        writer.write(
          encodeResult('project.discover', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: protocolResultSchemas['project.discover'].parse(result),
          }),
        );
        return;
      }
      case 'config.get': {
        const state = await application.getConfiguration(request.params.repository);
        writer.write(
          encodeResult('config.get', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: {
              exists: state.exists,
              path: state.path,
              ...(state.config === undefined ? {} : { config: state.config }),
            },
          }),
        );
        return;
      }
      case 'config.init': {
        const result = await application.initializeProject({
          repository: request.params.repository,
          force: request.params.force === true,
        });
        writer.write(
          encodeResult('config.init', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: protocolResultSchemas['config.init'].parse(result),
          }),
        );
        return;
      }
      case 'repository.inspect': {
        const result = await application.inspectRepository(request.params.repository);
        writer.write(
          encodeResult('repository.inspect', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result,
          }),
        );
        return;
      }
      case 'verification.run': {
        const run = await application.runVerification({
          repository: request.params.repository,
          onEvent: (event, runId) => {
            switch (event.type) {
              case 'check.started':
                writer.write(
                  encodeEvent({
                    protocolVersion: PROTOCOL_VERSION,
                    id: request.id,
                    event: 'check.started',
                    data: { runId, check: event.check, startedAt: event.timestamp },
                  }),
                );
                break;
              case 'check.output':
                writer.write(
                  encodeEvent({
                    protocolVersion: PROTOCOL_VERSION,
                    id: request.id,
                    event: 'check.output',
                    data: {
                      runId,
                      checkId: event.checkId,
                      stream: event.stream,
                      chunk: event.chunk,
                      timestamp: event.timestamp,
                    },
                  }),
                );
                break;
              case 'check.completed':
                writer.write(
                  encodeEvent({
                    protocolVersion: PROTOCOL_VERSION,
                    id: request.id,
                    event: 'check.completed',
                    data: { runId, result: event.result },
                  }),
                );
                break;
            }
          },
        });
        writer.write(
          encodeEvent({
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            event: 'run.completed',
            data: { run },
          }),
        );
        writer.write(
          encodeResult('verification.run', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: run,
          }),
        );
        return;
      }
      case 'gate.latest': {
        try {
          const run = await application.getLatestRun(request.params.repository);
          writer.write(
            encodeResult('gate.latest', {
              protocolVersion: PROTOCOL_VERSION,
              id: request.id,
              result: run.gate === undefined ? null : { runId: run.id, gate: run.gate },
            }),
          );
        } catch (error) {
          if (!(error instanceof NoVerificationRunError)) throw error;
          writer.write(
            encodeResult('gate.latest', {
              protocolVersion: PROTOCOL_VERSION,
              id: request.id,
              result: null,
            }),
          );
        }
        return;
      }
      case 'runs.list': {
        const runs = await application.getRunHistory(
          request.params.repository,
          request.params.limit,
        );
        writer.write(
          encodeResult('runs.list', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: { runs },
          }),
        );
        return;
      }
    }
  } catch (error) {
    writer.diagnostic(`Protocol ${request.method} failed: ${formatError(error)}\n`);
    writer.write(encodeProtocolError(request.id, classifyError(error), formatError(error)));
  }
}

function classifyError(error: unknown): ProtocolErrorCode {
  if (
    error instanceof ConfigValidationError ||
    error instanceof ConfigNotFoundError ||
    error instanceof ConfigUnsafePathError
  ) {
    return 'CONFIG_ERROR';
  }
  if (error instanceof ConfigAlreadyExistsError) return 'CONFIG_ERROR';
  if (error instanceof NoVerificationRunError) return 'NOT_FOUND';
  if (error instanceof ProtocolDecodeError) return 'INVALID_REQUEST';
  if (error instanceof Error && error.name === 'AbortError') return 'INTERRUPTED';
  return 'EXECUTION_ERROR';
}

function encodeProtocolError(id: string | null, code: ProtocolErrorCode, message: string): string {
  return encodeError({
    protocolVersion: PROTOCOL_VERSION,
    id,
    error: { code, message: message.length > 0 ? message : 'Unknown protocol error.' },
  });
}
