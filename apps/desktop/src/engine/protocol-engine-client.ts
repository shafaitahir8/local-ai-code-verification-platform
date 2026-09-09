import {
  createServerMessageDecoder,
  decodeResultLine,
  encodeRequest,
  PROTOCOL_VERSION,
  type ProtocolErrorMessage,
  type ProtocolMethod,
  type ProtocolParamsMap,
  type ProtocolResultMap,
  type ProtocolServerMessage,
  type UnknownProtocolResultMessage,
} from '@verify/protocol';

import {
  EngineRequestError,
  type EngineClient,
  type EngineRequestOptions,
  type EngineTransport,
} from './contracts.js';

export interface ProtocolEngineClientOptions {
  readonly createRequestId?: () => string;
}

function defaultRequestIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `desktop-${sequence.toString(36)}`;
  };
}

export class ProtocolEngineClient implements EngineClient {
  readonly #transport: EngineTransport;
  readonly #createRequestId: () => string;

  public constructor(transport: EngineTransport, options: ProtocolEngineClientOptions = {}) {
    this.#transport = transport;
    this.#createRequestId = options.createRequestId ?? defaultRequestIdFactory();
  }

  public async request<Method extends ProtocolMethod>(
    method: Method,
    params: ProtocolParamsMap[Method],
    options: EngineRequestOptions = {},
  ): Promise<ProtocolResultMap[Method]> {
    const id = this.#createRequestId();
    const requestLine = encodeRequest({
      protocolVersion: PROTOCOL_VERSION,
      id,
      method,
      params,
    });
    const decoder = createServerMessageDecoder();
    let terminalMessage: ProtocolErrorMessage | UnknownProtocolResultMessage | undefined;
    let processingError: Error | undefined;

    const processMessage = (message: ProtocolServerMessage) => {
      if (message.id !== id || processingError) {
        return;
      }

      if ('event' in message) {
        options.onEvent?.(message);
        return;
      }

      if (terminalMessage) {
        processingError = new EngineRequestError(
          'DUPLICATE_TERMINAL',
          `Engine request ${id} produced more than one terminal response.`,
        );
        return;
      }

      terminalMessage = message;
    };

    const onChunk = (chunk: string) => {
      try {
        for (const message of decoder.push(chunk)) {
          processMessage(message);
        }
      } catch (error) {
        processingError = error instanceof Error ? error : new Error(String(error));
      }
    };

    try {
      await this.#transport.request(requestLine, onChunk, options.signal);
      for (const message of decoder.finish()) {
        processMessage(message);
      }
    } catch (error) {
      if (options.signal?.aborted) {
        if (error instanceof EngineRequestError) {
          throw error;
        }
        throw new EngineRequestError(
          'INTERRUPTED',
          'The engine request was interrupted.',
          undefined,
          {
            cause: error,
          },
        );
      }

      throw error instanceof EngineRequestError
        ? error
        : new EngineRequestError(
            'TRANSPORT_ERROR',
            error instanceof Error ? error.message : 'The engine transport failed.',
            undefined,
            { cause: error },
          );
    }

    if (processingError) {
      throw new EngineRequestError('PROTOCOL_ERROR', processingError.message, undefined, {
        cause: processingError,
      });
    }

    if (!terminalMessage) {
      throw new EngineRequestError(
        'MISSING_TERMINAL',
        `Engine request ${id} ended without a terminal result or error.`,
      );
    }

    const terminalLine = JSON.stringify(terminalMessage);
    const decoded = decodeResultLine(method, terminalLine);

    if ('error' in decoded) {
      throw new EngineRequestError(
        decoded.error.code,
        decoded.error.message,
        decoded.error.details,
      );
    }

    return decoded.result;
  }
}
