import { decodeRequestLine, decodeServerMessageLine, ProtocolDecodeError } from './codec.js';
import type { ProtocolRequest, ProtocolServerMessage } from './messages.js';

const DEFAULT_MAX_LINE_LENGTH = 4 * 1024 * 1024;

export interface NdjsonDecoderOptions {
  readonly maxLineLength?: number;
  /** Empty/whitespace-only lines are ignored when true. */
  readonly ignoreEmptyLines?: boolean;
}

/** Stateful UTF-8 NDJSON decoder suitable for arbitrary stdout/stdin chunks. */
export class NdjsonDecoder<Message> {
  readonly #parse: (line: string) => Message;
  readonly #maxLineLength: number;
  readonly #ignoreEmptyLines: boolean;
  #buffer = '';
  #lineNumber = 0;

  public constructor(parse: (line: string) => Message, options: NdjsonDecoderOptions = {}) {
    this.#parse = parse;
    this.#maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    this.#ignoreEmptyLines = options.ignoreEmptyLines ?? true;

    if (!Number.isInteger(this.#maxLineLength) || this.#maxLineLength < 1) {
      throw new RangeError('maxLineLength must be a positive integer.');
    }
  }

  public push(chunk: string): Message[] {
    this.#buffer += chunk;
    this.#assertLength();
    const messages: Message[] = [];

    while (true) {
      const newlineIndex = this.#buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const rawLine = this.#buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      this.#lineNumber += 1;
      this.#decode(rawLine, messages);
      this.#assertLength();
    }

    return messages;
  }

  public finish(): Message[] {
    if (this.#buffer.length === 0) {
      return [];
    }

    const rawLine = this.#buffer.replace(/\r$/, '');
    this.#buffer = '';
    this.#lineNumber += 1;
    const messages: Message[] = [];
    this.#decode(rawLine, messages);
    return messages;
  }

  public reset(): void {
    this.#buffer = '';
    this.#lineNumber = 0;
  }

  #decode(rawLine: string, messages: Message[]): void {
    if (rawLine.trim().length === 0 && this.#ignoreEmptyLines) {
      return;
    }

    try {
      messages.push(this.#parse(rawLine));
    } catch (error) {
      if (error instanceof ProtocolDecodeError) {
        throw new ProtocolDecodeError(
          error.code,
          `${error.message} (line ${this.#lineNumber})`,
          this.#lineNumber,
          error.validationError,
          { cause: error },
        );
      }
      throw error;
    }
  }

  #assertLength(): void {
    const pendingLineLength = this.#buffer.includes('\n')
      ? this.#buffer.indexOf('\n')
      : this.#buffer.length;
    if (pendingLineLength > this.#maxLineLength) {
      throw new ProtocolDecodeError(
        'LINE_TOO_LONG',
        `NDJSON line exceeds the ${this.#maxLineLength}-character limit.`,
        this.#lineNumber + 1,
      );
    }
  }
}

export function createRequestDecoder(
  options?: NdjsonDecoderOptions,
): NdjsonDecoder<ProtocolRequest> {
  return new NdjsonDecoder(decodeRequestLine, options);
}

export function createServerMessageDecoder(
  options?: NdjsonDecoderOptions,
): NdjsonDecoder<ProtocolServerMessage> {
  return new NdjsonDecoder(decodeServerMessageLine, options);
}
