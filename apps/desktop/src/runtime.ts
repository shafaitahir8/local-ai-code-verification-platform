import { invoke } from '@tauri-apps/api/core';

import {
  createMockEngineClient,
  ProtocolEngineClient,
  TauriEngineTransport,
  type EngineClient,
  type MockGateScenario,
} from './engine/index.js';

export type RepositoryPicker = () => Promise<string | null>;

export interface DesktopRuntime {
  readonly client: EngineClient;
  readonly pickRepository: RepositoryPicker;
  readonly kind: 'tauri' | 'browser-mock';
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

function requestedMockScenario(): MockGateScenario {
  const value = new URLSearchParams(window.location.search).get('scenario')?.toUpperCase();
  return value === 'WARN' || value === 'BLOCK' ? value : 'PASS';
}

export function createRuntime(): DesktopRuntime {
  if (isTauriRuntime()) {
    return {
      client: new ProtocolEngineClient(new TauriEngineTransport()),
      pickRepository: () => invoke<string | null>('select_repository'),
      kind: 'tauri',
    };
  }

  const client = createMockEngineClient({
    gateScenario: requestedMockScenario(),
    configExists: new URLSearchParams(window.location.search).get('uninitialized') !== '1',
  });

  return {
    client,
    pickRepository: async () => 'C:\\workspace\\atlas-web',
    kind: 'browser-mock',
  };
}
