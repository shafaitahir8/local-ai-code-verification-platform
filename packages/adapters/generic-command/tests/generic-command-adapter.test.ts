import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { VerificationCheck } from '@verify/domain';
import { describe, expect, it } from 'vitest';

import { GenericCommandAdapter } from '../src/index.js';

const adapter = new GenericCommandAdapter();

function nodeCommand(script: string): string {
  const encoded = Buffer.from(script).toString('base64');
  return `"${process.execPath}" -e "eval(Buffer.from('${encoded}','base64').toString())"`;
}

function createCheck(command: string): VerificationCheck {
  return {
    id: 'contract-check',
    name: 'Contract check',
    type: 'test',
    command,
    failurePolicy: 'block',
  };
}

describe('GenericCommandAdapter contract', () => {
  it('captures stdout and a successful exit code', async () => {
    const chunks: string[] = [];
    const result = await adapter.execute(
      createCheck(nodeCommand("process.stdout.write('hello')")),
      {
        repositoryRoot: process.cwd(),
        onOutput: (event) => chunks.push(event.chunk),
      },
    );

    expect(result.status).toBe('passed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(chunks.join('')).toBe('hello');
  });

  it('captures stderr and normalizes a failing exit', async () => {
    const result = await adapter.execute(
      createCheck(nodeCommand("process.stderr.write('broken');process.exit(7)")),
      { repositoryRoot: process.cwd() },
    );

    expect(result.status).toBe('failed');
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toBe('broken');
    expect(result.errorSummary).toContain('7');
  });

  it('streams full output while bounding the copy retained as evidence', async () => {
    let streamedCharacters = 0;
    const result = await adapter.execute(
      createCheck(nodeCommand("process.stdout.write('x'.repeat(600000))")),
      {
        repositoryRoot: process.cwd(),
        onOutput: (event) => {
          streamedCharacters += event.chunk.length;
        },
      },
    );

    expect(streamedCharacters).toBe(600_000);
    expect(result.stdout?.length).toBeLessThan(600_000);
    expect(result.stdout).toContain('output truncated');
  });

  it('uses the requested working directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'verify-cwd-'));
    try {
      const result = await adapter.execute(
        createCheck(nodeCommand('process.stdout.write(process.cwd())')),
        { repositoryRoot: directory },
      );
      expect(result.stdout?.toLowerCase()).toBe(directory.toLowerCase());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('merges explicitly provided environment values', async () => {
    const result = await adapter.execute(
      createCheck(nodeCommand("process.stdout.write(process.env.VERIFY_CONTRACT_VALUE ?? '')")),
      {
        repositoryRoot: process.cwd(),
        environment: { VERIFY_CONTRACT_VALUE: 'visible' },
      },
    );

    expect(result.stdout).toBe('visible');
  });

  it('reports a missing executable as an error, never a pass', async () => {
    const result = await adapter.execute(
      createCheck(`verify-command-that-does-not-exist-${Date.now()}`),
      { repositoryRoot: process.cwd() },
    );

    expect(result.status).toBe('error');
    expect(result.errorSummary).toContain('could not be executed');
  });

  it('times out a long-running command', async () => {
    const result = await adapter.execute(createCheck(nodeCommand('setTimeout(() => {}, 5000)')), {
      repositoryRoot: process.cwd(),
      timeoutMs: 30,
    });

    expect(result.status).toBe('error');
    expect(result.errorSummary).toContain('timed out');
  });

  it('cancels an active command', async () => {
    const controller = new AbortController();
    const completion = adapter.execute(createCheck(nodeCommand('setTimeout(() => {}, 5000)')), {
      repositoryRoot: process.cwd(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25);

    const result = await completion;
    expect(result.status).toBe('cancelled');
  });

  it('does not start when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await adapter.execute(createCheck(nodeCommand('process.exit(0)')), {
      repositoryRoot: process.cwd(),
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBeUndefined();
  });
});
