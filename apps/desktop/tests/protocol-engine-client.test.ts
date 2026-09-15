import {
  decodeRequestLine,
  encodeError,
  encodeEvent,
  encodeResult,
  PROTOCOL_VERSION,
} from '@verify/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  ProtocolEngineClient,
  createMockEngineClient,
  type EngineRequestError,
  type EngineTransport,
} from '../src/engine/index.js';

describe('ProtocolEngineClient', () => {
  it('streams versioned events and returns the typed terminal result', async () => {
    const transport: EngineTransport = {
      request: async (_request, onChunk) => {
        onChunk(
          encodeEvent({
            protocolVersion: PROTOCOL_VERSION,
            id: 'fixed-id',
            event: 'check.output',
            data: {
              runId: 'run-1',
              checkId: 'test',
              stream: 'stdout',
              chunk: 'passing\n',
              timestamp: '2026-09-07T12:00:00.000Z',
            },
          }),
        );
        onChunk(
          encodeResult('runs.list', {
            protocolVersion: PROTOCOL_VERSION,
            id: 'fixed-id',
            result: { runs: [] },
          }),
        );
      },
    };
    const event = vi.fn();
    const client = new ProtocolEngineClient(transport, { createRequestId: () => 'fixed-id' });

    await expect(
      client.request('runs.list', { repository: '/repo' }, { onEvent: event }),
    ).resolves.toEqual({ runs: [] });
    expect(event).toHaveBeenCalledWith(expect.objectContaining({ event: 'check.output' }));
  });

  it('turns structured engine errors into EngineRequestError', async () => {
    const transport: EngineTransport = {
      request: async (_request, onChunk) => {
        onChunk(
          encodeError({
            protocolVersion: PROTOCOL_VERSION,
            id: 'fixed-id',
            error: { code: 'CONFIG_ERROR', message: 'Configuration is invalid.' },
          }),
        );
      },
    };
    const client = new ProtocolEngineClient(transport, { createRequestId: () => 'fixed-id' });

    await expect(client.request('config.get', { repository: '/repo' })).rejects.toEqual(
      expect.objectContaining<Partial<EngineRequestError>>({
        name: 'EngineRequestError',
        code: 'CONFIG_ERROR',
        message: 'Configuration is invalid.',
      }),
    );
  });

  it('preserves the exact normalized run across the GUI protocol-client boundary', async () => {
    const repository = 'C:\\work\\equivalence-project';
    const expected = await createMockEngineClient({ latencyMs: 0, gateScenario: 'WARN' }).request(
      'verification.run',
      { repository },
    );
    const transport: EngineTransport = {
      request: async (requestLine, onChunk) => {
        const request = decodeRequestLine(requestLine);
        expect(request).toMatchObject({
          protocolVersion: PROTOCOL_VERSION,
          id: 'equivalence-id',
          method: 'verification.run',
          params: { repository },
        });
        onChunk(
          encodeEvent({
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            event: 'run.completed',
            data: { run: expected },
          }),
        );
        onChunk(
          encodeResult('verification.run', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: expected,
          }),
        );
      },
    };
    const event = vi.fn();
    const client = new ProtocolEngineClient(transport, {
      createRequestId: () => 'equivalence-id',
    });

    const actual = await client.request('verification.run', { repository }, { onEvent: event });

    expect(actual).toStrictEqual(expected);
    expect(event).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'run.completed', data: { run: expected } }),
    );
  });

  it('preserves the exact project profile and forwards correlated progress events', async () => {
    const repository = 'C:\\work\\profile-equivalence-project';
    const expected = await createMockEngineClient({ latencyMs: 0 }).request('project.profile', {
      repository,
    });
    expect(expected.status).toBe('completed');
    const progress = {
      phase: 'sensors' as const,
      message: 'Inspecting Node project evidence.',
      entriesScanned: 18,
      bytesRead: 2_048,
      sensorsCompleted: 0,
      sensorCount: 1,
    };
    const transport: EngineTransport = {
      request: async (requestLine, onChunk) => {
        const request = decodeRequestLine(requestLine);
        expect(request).toMatchObject({
          protocolVersion: PROTOCOL_VERSION,
          id: 'profile-equivalence-id',
          method: 'project.profile',
          params: { repository },
        });
        onChunk(
          encodeEvent({
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            event: 'profile.progress',
            data: progress,
          }),
        );
        onChunk(
          encodeResult('project.profile', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: expected,
          }),
        );
      },
    };
    const event = vi.fn();
    const client = new ProtocolEngineClient(transport, {
      createRequestId: () => 'profile-equivalence-id',
    });

    await expect(
      client.request('project.profile', { repository }, { onEvent: event }),
    ).resolves.toStrictEqual(expected);
    expect(event).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'profile.progress', data: progress }),
    );
  });

  it('preserves the exact deterministic plan preview and its profiled source', async () => {
    const repository = 'C:\\work\\plan-equivalence-project';
    const expected = await createMockEngineClient({ latencyMs: 0 }).request('verification.plan', {
      repository,
    });
    expect(expected.status).toBe('completed');
    const transport: EngineTransport = {
      request: async (requestLine, onChunk) => {
        const request = decodeRequestLine(requestLine);
        expect(request).toMatchObject({
          protocolVersion: PROTOCOL_VERSION,
          id: 'plan-equivalence-id',
          method: 'verification.plan',
          params: { repository },
        });
        onChunk(
          encodeResult('verification.plan', {
            protocolVersion: PROTOCOL_VERSION,
            id: request.id,
            result: expected,
          }),
        );
      },
    };
    const client = new ProtocolEngineClient(transport, {
      createRequestId: () => 'plan-equivalence-id',
    });

    await expect(client.request('verification.plan', { repository })).resolves.toStrictEqual(
      expected,
    );
  });

  it('returns a persisted cancelled terminal after the caller requests interruption', async () => {
    const repository = 'C:\\work\\cancelled-project';
    const completed = await createMockEngineClient({ latencyMs: 0 }).request('verification.run', {
      repository,
    });
    const cancelled = {
      ...completed,
      id: 'cancelled-id',
      status: 'cancelled' as const,
      checks: [],
      gate: {
        status: 'BLOCK' as const,
        reasons: ['No verification checks were run.'],
        evaluatedAt: completed.completedAt ?? completed.startedAt,
        summary: {
          total: 0,
          passed: 0,
          warning: 0,
          failed: 0,
          error: 0,
          cancelled: 0,
          skipped: 0,
        },
      },
    };
    const controller = new AbortController();
    const transport: EngineTransport = {
      request: async (_requestLine, onChunk) => {
        controller.abort();
        onChunk(
          encodeResult('verification.run', {
            protocolVersion: PROTOCOL_VERSION,
            id: 'cancelled-id',
            result: cancelled,
          }),
        );
      },
    };
    const client = new ProtocolEngineClient(transport, {
      createRequestId: () => 'cancelled-id',
    });

    await expect(
      client.request('verification.run', { repository }, { signal: controller.signal }),
    ).resolves.toStrictEqual(cancelled);
  });
});
