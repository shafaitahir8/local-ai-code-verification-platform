import type { VerificationAdapter } from '../src/contracts.js';
import { MAX_RETAINED_OUTPUT_JSON_CHARACTERS, VerificationRunner } from '../src/runner.js';
import { describe, expect, it, vi } from 'vitest';

const check = {
  id: 'test',
  name: 'test',
  type: 'test',
  command: 'npm test',
  failurePolicy: 'block' as const,
};

describe('VerificationRunner', () => {
  it('runs checks in order and emits lifecycle events', async () => {
    const executed: string[] = [];
    const adapter: VerificationAdapter = {
      id: 'fake',
      execute: async (current) => {
        executed.push(current.id);
        const now = new Date().toISOString();
        return {
          id: current.id,
          name: current.name,
          type: current.type,
          command: current.command,
          failurePolicy: current.failurePolicy,
          status: 'passed',
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          exitCode: 0,
          stdout: '',
          stderr: '',
          findings: [],
          artifacts: [],
        };
      },
    };
    const eventTypes: string[] = [];
    const runner = new VerificationRunner(adapter);

    const evidence = await runner.run({
      checks: [check, { ...check, id: 'lint', name: 'lint' }],
      repositoryRoot: process.cwd(),
      onEvent: (event) => eventTypes.push(event.type),
    });

    expect(executed).toEqual(['test', 'lint']);
    expect(eventTypes).toEqual([
      'check.started',
      'check.completed',
      'check.started',
      'check.completed',
    ]);
    expect(evidence.results).toHaveLength(2);
    expect(evidence.interrupted).toBe(false);
  });

  it('does not start a check after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn();
    const adapter: VerificationAdapter = {
      id: 'unused',
      execute,
    };

    const evidence = await new VerificationRunner(adapter).run({
      checks: [check],
      repositoryRoot: process.cwd(),
      signal: controller.signal,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(evidence.interrupted).toBe(true);
  });

  it('retains cancellation accepted as the final check completes', async () => {
    const controller = new AbortController();
    const adapter: VerificationAdapter = {
      id: 'late-cancel',
      execute: async (current) => {
        controller.abort();
        const now = new Date().toISOString();
        return {
          ...current,
          status: 'passed',
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          exitCode: 0,
          findings: [],
          artifacts: [],
        };
      },
    };

    const evidence = await new VerificationRunner(adapter).run({
      checks: [check],
      repositoryRoot: process.cwd(),
      signal: controller.signal,
    });

    expect(evidence.results).toHaveLength(1);
    expect(evidence.interrupted).toBe(true);
  });

  it('bounds retained output for persistence and terminal protocol messages', async () => {
    const output = '\u0000'.repeat(MAX_RETAINED_OUTPUT_JSON_CHARACTERS);
    const adapter: VerificationAdapter = {
      id: 'verbose',
      execute: async (current) => {
        const now = new Date().toISOString();
        return {
          ...current,
          status: 'passed',
          startedAt: now,
          completedAt: now,
          durationMs: 0,
          stdout: output,
          stderr: output,
          findings: [],
          artifacts: [],
        };
      },
    };

    const evidence = await new VerificationRunner(adapter).run({
      checks: [check],
      repositoryRoot: process.cwd(),
    });
    const serialized = JSON.stringify(evidence.results);

    expect(serialized.length).toBeLessThan(MAX_RETAINED_OUTPUT_JSON_CHARACTERS + 1_000);
    expect(serialized).toContain('truncated');
  });
});
