import type { VerificationRun } from '@verify/domain';
import { describe, expect, it } from 'vitest';

import {
  createRequestDecoder,
  decodeRequestLine,
  decodeResultLine,
  decodeServerMessageLine,
  encodeError,
  encodeEvent,
  encodeRequest,
  encodeResult,
  NdjsonDecoder,
  ProtocolDecodeError,
  PROTOCOL_VERSION,
  type ProtocolEventMessage,
  type ProtocolRequest,
} from '../src/index.js';

function completedRun(): VerificationRun {
  return {
    id: 'run-1',
    projectId: 'project-1',
    repositoryRoot: '/workspace/example',
    status: 'completed',
    startedAt: '2026-09-07T08:00:00.000Z',
    completedAt: '2026-09-07T08:00:01.000Z',
    durationMs: 1_000,
    checks: [
      {
        id: 'test',
        name: 'Unit tests',
        type: 'test',
        command: 'npm test',
        failurePolicy: 'block',
        status: 'passed',
        startedAt: '2026-09-07T08:00:00.000Z',
        completedAt: '2026-09-07T08:00:01.000Z',
        durationMs: 1_000,
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        findings: [],
        artifacts: [
          {
            type: 'log',
            path: '/workspace/example/.verify/test.log',
            source: 'generic-command',
            metadata: { retained: true },
          },
        ],
      },
    ],
    gate: {
      status: 'PASS',
      reasons: [],
      evaluatedAt: '2026-09-07T08:00:01.000Z',
      summary: {
        total: 1,
        passed: 1,
        warning: 0,
        failed: 0,
        error: 0,
        cancelled: 0,
        skipped: 0,
      },
    },
  };
}

describe('protocol request codec', () => {
  it('round-trips a method-specific request as one NDJSON record', () => {
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'request-1',
      method: 'runs.list',
      params: { repository: '/workspace/example', limit: 10 },
    } satisfies ProtocolRequest<'runs.list'>;

    const encoded = encodeRequest(request);
    expect(encoded.endsWith('\n')).toBe(true);
    expect(encoded.split('\n')).toHaveLength(2);
    expect(decodeRequestLine(encoded)).toEqual(request);
  });

  it('round-trips an additive cancellation request with its own correlation id', () => {
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-1',
      method: 'verification.cancel',
      params: { targetRequestId: 'run-1' },
    } satisfies ProtocolRequest<'verification.cancel'>;

    const encoded = encodeRequest(request);

    expect(decodeRequestLine(encoded)).toEqual(request);
    expect(
      decodeResultLine(
        'verification.cancel',
        encodeResult('verification.cancel', {
          protocolVersion: PROTOCOL_VERSION,
          id: request.id,
          result: { accepted: true },
        }),
      ),
    ).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      id: request.id,
      result: { accepted: true },
    });
  });

  it('rejects incompatible versions, unknown methods, extra fields, and malformed params', () => {
    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 2,
          id: 'request-1',
          method: 'runs.list',
          params: { repository: '/workspace/example' },
        }),
      ),
    ).toThrow(ProtocolDecodeError);

    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          id: 'request-1',
          method: 'unknown.method',
          params: {},
        }),
      ),
    ).toThrow(ProtocolDecodeError);

    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          id: 'request-1',
          method: 'runs.list',
          params: { repository: '/workspace/example', limit: 0 },
          consoleOutput: 'must not enter the protocol',
        }),
      ),
    ).toThrow(ProtocolDecodeError);

    expect(() =>
      decodeRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          id: 'cancel-1',
          method: 'verification.cancel',
          params: { targetRequestId: '', force: true },
        }),
      ),
    ).toThrow(ProtocolDecodeError);
  });
});

describe('server message codec', () => {
  it('round-trips output events without splitting embedded newlines', () => {
    const event: ProtocolEventMessage = {
      protocolVersion: 1,
      id: 'request-1',
      event: 'check.output',
      data: {
        runId: 'run-1',
        checkId: 'test',
        stream: 'stdout',
        chunk: 'first line\nsecond line\n',
        timestamp: '2026-09-07T08:00:00.500Z',
      },
    };

    const encoded = encodeEvent(event);
    expect(encoded.split('\n')).toHaveLength(2);
    expect(decodeServerMessageLine(encoded)).toEqual(event);
  });

  it('validates a terminal result against its correlated method', () => {
    const run = completedRun();
    const encoded = encodeResult('verification.run', {
      protocolVersion: 1,
      id: 'request-1',
      result: run,
    });

    expect(decodeResultLine('verification.run', encoded)).toEqual({
      protocolVersion: 1,
      id: 'request-1',
      result: run,
    });
    expect(() => decodeResultLine('repository.inspect', encoded)).toThrow(ProtocolDecodeError);
  });

  it('round-trips structured errors, including uncorrelated parse failures', () => {
    const encoded = encodeError({
      protocolVersion: 1,
      id: null,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Request JSON could not be decoded.',
        details: { line: 1 },
      },
    });

    expect(decodeServerMessageLine(encoded)).toEqual({
      protocolVersion: 1,
      id: null,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Request JSON could not be decoded.',
        details: { line: 1 },
      },
    });
  });

  it('rejects a domain result with an impossible timestamp or missing evidence', () => {
    const invalidRun = {
      ...completedRun(),
      completedAt: 'not-a-date',
      checks: [{ ...completedRun().checks[0], findings: undefined }],
    };
    expect(() =>
      encodeResult('verification.run', {
        protocolVersion: 1,
        id: 'request-1',
        // Runtime validation is deliberately tested with untrusted input.
        result: invalidRun as unknown as VerificationRun,
      }),
    ).toThrow(ProtocolDecodeError);
  });
});

describe('streaming NDJSON decoder', () => {
  it('decodes split chunks, multiple records, CRLF, and a final unterminated record', () => {
    const first = encodeRequest({
      protocolVersion: 1,
      id: 'one',
      method: 'config.get',
      params: { repository: '/one' },
    });
    const second = encodeRequest({
      protocolVersion: 1,
      id: 'two',
      method: 'project.discover',
      params: { repository: '/two' },
    }).trimEnd();
    const decoder = createRequestDecoder();

    expect(decoder.push(first.slice(0, 12))).toEqual([]);
    const decoded = decoder.push(`${first.slice(12).replace(/\n$/, '\r\n')}\n`);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.id).toBe('one');
    expect(decoder.push(second)).toEqual([]);
    expect(decoder.finish()[0]?.id).toBe('two');
  });

  it('reports source line numbers and enforces a bounded pending line', () => {
    const decoder = createRequestDecoder();
    decoder.push('\n');
    expect(() => decoder.push('{bad json}\n')).toThrowError(
      expect.objectContaining({ lineNumber: 2, code: 'INVALID_JSON' }),
    );

    const bounded = new NdjsonDecoder(decodeRequestLine, { maxLineLength: 8 });
    expect(() => bounded.push('123456789')).toThrowError(
      expect.objectContaining({ code: 'LINE_TOO_LONG', lineNumber: 1 }),
    );
  });
});
