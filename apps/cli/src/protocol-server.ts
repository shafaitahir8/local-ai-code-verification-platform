import { createInterface } from 'node:readline';

import {
  NoVerificationRunError,
  PolicyApprovalStaleError,
  PolicyApprovalUnavailableError,
  type VerifierApplication,
} from '@verify/core';
import {
  ConfigAlreadyExistsError,
  ConfigMigrationStaleError,
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

interface ProtocolRequestContext {
  readonly signal?: AbortSignal;
  readonly cancelTarget?: (
    targetRequestId: string,
    expectedMethod?: CancellableProtocolMethod,
  ) => boolean;
}

type CancellableProtocolMethod = 'project.profile' | 'verification.plan' | 'verification.run';

interface CancellableOperation {
  readonly method: CancellableProtocolMethod;
  readonly controller: AbortController;
}

function yieldForCancellationFrames(): Promise<void> {
  return new Promise((resolvePromise) => setImmediate(resolvePromise));
}

class ProtocolSession {
  readonly #activeRequestIds = new Set<string>();
  readonly #cancellableOperations = new Map<string, CancellableOperation>();
  readonly #operations = new Set<Promise<void>>();
  #serial: Promise<void> = Promise.resolve();

  public constructor(
    private readonly application: VerifierApplication,
    private readonly writer: ProtocolWriter,
  ) {}

  public accept(request: ProtocolRequest): void {
    if (this.#activeRequestIds.has(request.id)) {
      this.writer.write(
        encodeProtocolError(
          request.id,
          'INVALID_REQUEST',
          `Request id "${request.id}" is already active.`,
        ),
      );
      return;
    }

    this.#activeRequestIds.add(request.id);

    if (request.method === 'verification.cancel' || request.method === 'operation.cancel') {
      const operation = handleProtocolRequest(this.application, request, this.writer, {
        cancelTarget: (targetRequestId, expectedMethod) =>
          this.#cancel(targetRequestId, expectedMethod),
      }).finally(() => this.#activeRequestIds.delete(request.id));
      this.#track(operation);
      return;
    }

    const cancellableMethod =
      request.method === 'verification.run' ||
      request.method === 'verification.plan' ||
      request.method === 'project.profile'
        ? request.method
        : undefined;
    const controller = cancellableMethod === undefined ? undefined : new AbortController();
    if (cancellableMethod !== undefined && controller !== undefined) {
      // Registration is synchronous so a following control frame can cancel queued work.
      this.#cancellableOperations.set(request.id, {
        method: cancellableMethod,
        controller,
      });
    }

    const operation = this.#serial
      .then(async () => {
        if (controller !== undefined) {
          // Let an immediately following control frame abort this registered run before core starts.
          await yieldForCancellationFrames();
        }
        await handleProtocolRequest(
          this.application,
          request,
          this.writer,
          controller === undefined ? {} : { signal: controller.signal },
        );
      })
      .finally(() => {
        this.#activeRequestIds.delete(request.id);
        if (
          controller !== undefined &&
          this.#cancellableOperations.get(request.id)?.controller === controller
        ) {
          this.#cancellableOperations.delete(request.id);
        }
      });

    this.#serial = operation.catch(() => undefined);
    this.#track(operation);
  }

  public async drain(): Promise<void> {
    await Promise.all([...this.#operations]);
  }

  #track(operation: Promise<void>): void {
    this.#operations.add(operation);
    void operation.then(
      () => this.#operations.delete(operation),
      () => this.#operations.delete(operation),
    );
  }

  #cancel(targetRequestId: string, expectedMethod?: CancellableProtocolMethod): boolean {
    const operation = this.#cancellableOperations.get(targetRequestId);
    if (
      operation === undefined ||
      operation.controller.signal.aborted ||
      (expectedMethod !== undefined && operation.method !== expectedMethod)
    ) {
      return false;
    }
    operation.controller.abort();
    return true;
  }
}

export async function serveProtocol(application: VerifierApplication, io: CliIo): Promise<void> {
  const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  const writer: ProtocolWriter = {
    write: (value) => io.writeOut(value),
    diagnostic: (value) => io.writeError(value),
  };
  const session = new ProtocolSession(application, writer);

  for await (const line of input) {
    if (line.trim().length === 0) continue;
    let request: ProtocolRequest;
    try {
      request = decodeRequestLine(line);
    } catch (error) {
      writer.write(encodeProtocolError(null, 'INVALID_REQUEST', formatError(error)));
      continue;
    }
    session.accept(request);
  }

  await session.drain();
}

export async function handleProtocolRequest(
  application: VerifierApplication,
  request: ProtocolRequest,
  writer: ProtocolWriter,
  context: ProtocolRequestContext = {},
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
      case 'project.profile': {
        const result = await application.profileProject({
          repository: request.params.repository,
          signal: context.signal,
          onProgress: (progress) => {
            writer.write(
              encodeEvent({
                protocolVersion: PROTOCOL_VERSION,
                id: request.id,
                event: 'profile.progress',
                data: progress,
              }),
            );
          },
        });
        writer.write(
          encodeResult('project.profile', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result,
          }),
        );
        return;
      }
      case 'verification.plan': {
        const result = await application.previewVerificationPlans({
          repository: request.params.repository,
          signal: context.signal,
          onProgress: (progress) => {
            writer.write(
              encodeEvent({
                protocolVersion: PROTOCOL_VERSION,
                id: request.id,
                event: 'profile.progress',
                data: progress,
              }),
            );
          },
        });
        writer.write(
          encodeResult('verification.plan', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result,
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
      case 'config.policy.get': {
        const result = await application.getProjectPolicy(request.params.repository);
        writer.write(
          encodeResult('config.policy.get', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: protocolResultSchemas['config.policy.get'].parse(result),
          }),
        );
        return;
      }
      case 'config.migrate.preview': {
        const result = await application.previewProjectConfigMigration(request.params.repository);
        writer.write(
          encodeResult('config.migrate.preview', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result,
          }),
        );
        return;
      }
      case 'config.migrate.apply': {
        const result = await application.applyProjectConfigMigration({
          repository: request.params.repository,
          expectedSourceDigest: request.params.expectedSourceDigest,
          expectedTargetDigest: request.params.expectedTargetDigest,
        });
        writer.write(
          encodeResult('config.migrate.apply', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: protocolResultSchemas['config.migrate.apply'].parse(result),
          }),
        );
        return;
      }
      case 'config.approval.status': {
        const result = await application.getPolicyApprovalStatus(request.params.repository);
        writer.write(
          encodeResult('config.approval.status', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result,
          }),
        );
        return;
      }
      case 'config.approval.approve': {
        const result = await application.approveProjectPolicy({
          repository: request.params.repository,
          expectedPolicyDigest: request.params.expectedPolicyDigest,
        });
        writer.write(
          encodeResult('config.approval.approve', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result,
          }),
        );
        return;
      }
      case 'config.approval.revoke': {
        const result = await application.revokeProjectPolicyApproval(request.params.repository);
        writer.write(
          encodeResult('config.approval.revoke', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result,
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
      case 'verification.cancel': {
        writer.write(
          encodeResult('verification.cancel', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: {
              accepted:
                context.cancelTarget?.(request.params.targetRequestId, 'verification.run') ?? false,
            },
          }),
        );
        return;
      }
      case 'operation.cancel': {
        writer.write(
          encodeResult('operation.cancel', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: {
              accepted: context.cancelTarget?.(request.params.targetRequestId) ?? false,
            },
          }),
        );
        return;
      }
      case 'verification.run': {
        const run = await application.runVerification({
          repository: request.params.repository,
          signal: context.signal,
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
  if (error instanceof ConfigMigrationStaleError) return 'MIGRATION_STALE';
  if (error instanceof PolicyApprovalStaleError) return 'APPROVAL_STALE';
  if (error instanceof PolicyApprovalUnavailableError) return 'APPROVAL_UNAVAILABLE';
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
