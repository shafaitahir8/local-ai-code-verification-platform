import { describe, expect, it } from 'vitest';

import {
  VERIFICATION_PLAN_CHECK_KINDS,
  VERIFICATION_PLAN_MODES,
  VERIFICATION_PLAN_RECOMMENDATION_SOURCES,
  VERIFICATION_PLAN_STATUSES,
  VERIFICATION_PLAN_VERSION,
} from '../src/index.js';
import type { VerificationPlan, VerificationPlanPreviewResult } from '../src/index.js';

const plan: VerificationPlan<'quick'> = {
  planVersion: VERIFICATION_PLAN_VERSION,
  mode: 'quick',
  status: 'ready',
  statusReason: 'One evidence-backed check is selected.',
  repositoryRoot: '/repo',
  profileVersion: 1,
  profileGeneratedAt: '2026-09-15T00:00:00.000Z',
  profileCompleteness: 'complete',
  recommendationSource: 'deterministic-project-profile',
  selectedChecks: [
    {
      taskCandidateId: 'task.root.test.test',
      kind: 'test',
      label: 'Run test (test)',
      command: 'vitest run',
      workingDirectory: '.',
      workspaceId: 'workspace.root',
      confidence: 'confirmed',
      capabilityIds: ['test-framework.vitest'],
      evidenceIds: ['node.script.test'],
      reason: 'Selected from one confirmed test task.',
    },
  ],
  skippedChecks: [],
};

describe('verification plan domain contract', () => {
  it('keeps preview versions, modes, statuses, sources, and check kinds explicit', () => {
    expect(VERIFICATION_PLAN_VERSION).toBe(1);
    expect(VERIFICATION_PLAN_MODES).toEqual(['quick', 'full']);
    expect(VERIFICATION_PLAN_STATUSES).toEqual(['ready', 'unavailable']);
    expect(VERIFICATION_PLAN_RECOMMENDATION_SOURCES).toEqual(['deterministic-project-profile']);
    expect(VERIFICATION_PLAN_CHECK_KINDS).toEqual(['test', 'lint', 'typecheck', 'build']);
  });

  it('keeps a plan preview distinct from execution and approval policy', () => {
    expect(plan.selectedChecks[0]).toMatchObject({
      command: 'vitest run',
      taskCandidateId: 'task.root.test.test',
    });
    expect(plan).not.toHaveProperty('approval');
    expect(plan).not.toHaveProperty('failurePolicy');
    expect(plan).not.toHaveProperty('executedAt');
  });

  it('distinguishes a completed preview from a cancelled profile scan', () => {
    const cancelled: VerificationPlanPreviewResult = { status: 'cancelled' };

    expect(cancelled).toEqual({ status: 'cancelled' });
    expect(cancelled).not.toHaveProperty('preview');
  });
});
