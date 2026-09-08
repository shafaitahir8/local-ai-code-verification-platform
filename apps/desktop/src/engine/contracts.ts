import type {
  ProtocolEventMessage,
  ProtocolMethod,
  ProtocolParamsMap,
  ProtocolResultMap,
} from '@verify/protocol';

export interface EngineRequestOptions {
  readonly onEvent?: (event: ProtocolEventMessage) => void;
  readonly signal?: AbortSignal;
}

export interface EngineClient {
  request<Method extends ProtocolMethod>(
    method: Method,
    params: ProtocolParamsMap[Method],
    options?: EngineRequestOptions,
  ): Promise<ProtocolResultMap[Method]>;
}

export interface EngineTransport {
  request(
    requestLine: string,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

export class EngineRequestError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'EngineRequestError';
  }
}
