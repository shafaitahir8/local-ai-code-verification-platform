import { Channel, invoke } from '@tauri-apps/api/core';
import { decodeRequestLine } from '@verify/protocol';

import { EngineRequestError, type EngineTransport } from './contracts.js';

export class TauriEngineTransport implements EngineTransport {
  public async request(
    requestLine: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const request = decodeRequestLine(requestLine);
    let interrupted = signal?.aborted ?? false;
    const onEvent = new Channel<string>();
    onEvent.onmessage = (payload) => {
      onChunk(payload.endsWith('\n') ? payload : `${payload}\n`);
    };

    const interrupt = () => {
      interrupted = true;
      void invoke<boolean>('engine_interrupt', { requestId: request.id }).catch(() => undefined);
    };

    try {
      signal?.addEventListener('abort', interrupt, { once: true });

      if (interrupted) {
        throw new EngineRequestError('INTERRUPTED', 'The engine request was interrupted.');
      }

      let terminalLine: string;
      try {
        terminalLine = await invoke<string>('engine_request', { requestLine, onEvent });
      } catch (error) {
        if (interrupted) {
          throw new EngineRequestError('INTERRUPTED', 'The engine request was interrupted.');
        }
        throw error;
      }
      onChunk(terminalLine.endsWith('\n') ? terminalLine : `${terminalLine}\n`);

      if (interrupted) {
        throw new EngineRequestError('INTERRUPTED', 'The engine request was interrupted.');
      }
    } finally {
      signal?.removeEventListener('abort', interrupt);
    }
  }
}
