import { encodeRequest, encodeResult, PROTOCOL_VERSION } from '@verify/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class<T> {
    public onmessage?: (message: T) => void;
  },
  invoke,
}));

import { TauriEngineTransport } from '../src/engine/tauri-transport.js';

describe('TauriEngineTransport cancellation', () => {
  beforeEach(() => invoke.mockReset());

  it('starts an already-cancelled request and returns its confirmed terminal frame', async () => {
    const requestLine = encodeRequest({
      protocolVersion: PROTOCOL_VERSION,
      id: 'run-1',
      method: 'runs.list',
      params: { repository: 'C:\\work\\repository' },
    });
    const terminal = encodeResult('runs.list', {
      protocolVersion: PROTOCOL_VERSION,
      id: 'run-1',
      result: { runs: [] },
    });
    invoke.mockResolvedValueOnce(terminal).mockResolvedValueOnce(true);
    const controller = new AbortController();
    controller.abort();
    const chunks: string[] = [];

    await new TauriEngineTransport().request(
      requestLine,
      (chunk) => chunks.push(chunk),
      controller.signal,
    );

    expect(invoke).toHaveBeenCalledWith('engine_request', expect.objectContaining({ requestLine }));
    expect(invoke).toHaveBeenCalledWith('engine_interrupt', { requestId: 'run-1' });
    expect(chunks).toEqual([terminal]);
  });

  it('reports an interrupted request whose terminal result was not confirmed', async () => {
    const requestLine = encodeRequest({
      protocolVersion: PROTOCOL_VERSION,
      id: 'profile-1',
      method: 'project.profile',
      params: { repository: 'C:\\work\\repository' },
    });
    invoke.mockRejectedValueOnce(new Error('sidecar stopped')).mockResolvedValueOnce(true);
    const controller = new AbortController();
    controller.abort();

    await expect(
      new TauriEngineTransport().request(requestLine, () => undefined, controller.signal),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'INTERRUPTED',
        message: 'The engine interruption did not return a confirmed terminal result.',
      }),
    );

    expect(invoke).toHaveBeenCalledWith('engine_interrupt', { requestId: 'profile-1' });
  });
});
