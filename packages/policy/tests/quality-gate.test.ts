import type { VerificationCheckResult, VerificationCheckStatus } from '@verify/domain';
import { describe, expect, it } from 'vitest';

import {
  evaluateQualityGate,
  gateStatusToExitCode,
  QUALITY_GATE_EXIT_CODES,
} from '../src/index.js';

const evaluatedAt = '2026-01-02T03:04:05.000Z';

function result(
  status: VerificationCheckStatus,
  failurePolicy: VerificationCheckResult['failurePolicy'] = 'block',
  name: string = status,
): VerificationCheckResult {
  return {
    id: name,
    name,
    type: 'test',
    failurePolicy,
    status,
    startedAt: '2026-01-02T03:04:00.000Z',
    completedAt: '2026-01-02T03:04:01.000Z',
    durationMs: 1_000,
    findings: [],
    artifacts: [],
  };
}

describe('evaluateQualityGate', () => {
  it('passes when every check passed', () => {
    expect(evaluateQualityGate([result('passed')], { evaluatedAt })).toEqual({
      status: 'PASS',
      reasons: [],
      evaluatedAt,
      summary: {
        total: 1,
        passed: 1,
        warning: 0,
        failed: 0,
        error: 0,
        cancelled: 0,
        skipped: 0,
      },
    });
  });

  it('warns for a failed warn-policy check', () => {
    const gate = evaluateQualityGate([result('failed', 'warn', 'lint')], { evaluatedAt });

    expect(gate.status).toBe('WARN');
    expect(gate.reasons).toEqual(['Check "lint" failed under warn policy.']);
  });

  it('blocks for a failed block-policy check', () => {
    const gate = evaluateQualityGate([result('failed', 'block', 'test')], { evaluatedAt });

    expect(gate.status).toBe('BLOCK');
    expect(gate.reasons).toEqual(['Check "test" failed under block policy.']);
  });

  it.each(['error', 'cancelled'] as const)(
    'blocks %s even when the configured failure policy is warn',
    (status) => {
      expect(evaluateQualityGate([result(status, 'warn')], { evaluatedAt }).status).toBe('BLOCK');
    },
  );

  it.each(['warning', 'skipped'] as const)('warns when evidence is %s', (status) => {
    expect(evaluateQualityGate([result(status)], { evaluatedAt }).status).toBe('WARN');
  });

  it('preserves BLOCK precedence regardless of result order', () => {
    const warn = result('failed', 'warn', 'lint');
    const block = result('failed', 'block', 'build');

    expect(evaluateQualityGate([warn, block], { evaluatedAt }).status).toBe('BLOCK');
    expect(evaluateQualityGate([block, warn], { evaluatedAt }).status).toBe('BLOCK');
  });

  it('does not report an empty verification as PASS', () => {
    expect(evaluateQualityGate([], { evaluatedAt })).toMatchObject({
      status: 'WARN',
      reasons: ['No verification checks were run.'],
    });
    expect(evaluateQualityGate([], { evaluatedAt, emptyResultStatus: 'BLOCK' }).status).toBe(
      'BLOCK',
    );
  });
});

describe('gateStatusToExitCode', () => {
  it('uses the documented gate exit semantics', () => {
    expect(QUALITY_GATE_EXIT_CODES).toEqual({ PASS: 0, WARN: 0, BLOCK: 1 });
    expect(gateStatusToExitCode('PASS')).toBe(0);
    expect(gateStatusToExitCode('WARN')).toBe(0);
    expect(gateStatusToExitCode('BLOCK')).toBe(1);
  });
});
