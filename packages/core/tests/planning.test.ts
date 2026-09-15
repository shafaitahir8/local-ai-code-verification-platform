import type {
  ProjectCapability,
  ProjectEvidence,
  ProjectProfile,
  ProjectTaskCandidate,
} from '@verify/domain';
import { describe, expect, it } from 'vitest';

import { createVerificationPlan, createVerificationPlanPreview } from '../src/index.js';

const evidence: readonly ProjectEvidence[] = [
  {
    id: 'manifest',
    sensorId: 'node',
    kind: 'manifest',
    path: 'package.json',
    summary: 'Node package manifest is present.',
  },
  ...(['test', 'lint', 'typecheck', 'build', 'run'] as const).map((kind) => ({
    id: `script.${kind}`,
    sensorId: 'node',
    kind: 'script' as const,
    path: 'package.json',
    pointer: ['scripts', kind],
    summary: `package.json declares ${kind}.`,
  })),
  {
    id: 'config.vite',
    sensorId: 'node',
    kind: 'config',
    path: 'vite.config.ts',
    summary: 'Vite configuration is present.',
  },
  {
    id: 'config.vitest',
    sensorId: 'node',
    kind: 'config',
    path: 'vitest.config.ts',
    summary: 'Vitest configuration is present.',
  },
  {
    id: 'config.typescript',
    sensorId: 'node',
    kind: 'config',
    path: 'tsconfig.json',
    summary: 'TypeScript configuration is present.',
  },
];

const capabilities: readonly ProjectCapability[] = [
  {
    id: 'runtime.node',
    kind: 'runtime',
    name: 'Node.js',
    confidence: 'confirmed',
    evidenceIds: ['manifest'],
  },
  {
    id: 'framework.vite',
    kind: 'framework',
    name: 'Vite',
    confidence: 'confirmed',
    evidenceIds: ['config.vite'],
  },
  {
    id: 'test-framework.vitest',
    kind: 'test-framework',
    name: 'Vitest',
    confidence: 'confirmed',
    evidenceIds: ['config.vitest'],
  },
  {
    id: 'linter.eslint',
    kind: 'linter',
    name: 'ESLint',
    confidence: 'confirmed',
    evidenceIds: ['script.lint'],
  },
  {
    id: 'typechecker.typescript',
    kind: 'typechecker',
    name: 'TypeScript',
    confidence: 'confirmed',
    evidenceIds: ['config.typescript'],
  },
  {
    id: 'build-tool.vite',
    kind: 'build-tool',
    name: 'Vite',
    confidence: 'confirmed',
    evidenceIds: ['config.vite'],
  },
];

function task(
  kind: ProjectTaskCandidate['kind'],
  command: string,
  overrides: Partial<ProjectTaskCandidate> = {},
): ProjectTaskCandidate {
  return {
    id: `task.root.${kind}`,
    kind,
    label: `Run ${kind}`,
    command,
    workingDirectory: '.',
    workspaceId: 'workspace.root',
    confidence: 'confirmed',
    evidenceIds: [`script.${kind}`],
    ...overrides,
  };
}

function profile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    profileVersion: 1,
    repositoryRoot: '/repo',
    displayName: 'profile-fixture',
    generatedAt: '2026-09-15T00:00:00.000Z',
    completeness: 'complete',
    scan: {
      entriesScanned: 10,
      filesScanned: 8,
      directoriesScanned: 2,
      bytesRead: 512,
      skippedDirectories: 0,
      elapsedMs: 5,
      limitsReached: [],
    },
    capabilities,
    workspaceUnits: [
      {
        id: 'workspace.root',
        path: '.',
        name: 'profile-fixture',
        evidenceIds: ['manifest'],
      },
    ],
    taskCandidates: [
      task('test', 'vitest run'),
      task('build', 'vite build'),
      task('lint', 'eslint .'),
      task('typecheck', 'tsc --noEmit'),
      task('run', 'vite'),
    ],
    evidence,
    ambiguities: [],
    warnings: [],
    ...overrides,
  };
}

describe('deterministic verification planning', () => {
  it('creates meaningfully different Quick and Full previews without inventing commands', () => {
    const preview = createVerificationPlanPreview(profile());

    expect(preview.plans.quick.selectedChecks.map((check) => check.kind)).toEqual(['test', 'lint']);
    expect(preview.plans.quick.skippedChecks.map((check) => check.kind)).toEqual([
      'typecheck',
      'build',
    ]);
    expect(preview.plans.full.selectedChecks.map((check) => check.kind)).toEqual([
      'test',
      'lint',
      'typecheck',
      'build',
    ]);
    expect(preview.plans.full.skippedChecks).toEqual([]);
    expect(preview.plans.full.selectedChecks.map((check) => check.command)).toEqual([
      'vitest run',
      'eslint .',
      'tsc --noEmit',
      'vite build',
    ]);
    expect(
      [...preview.plans.quick.selectedChecks, ...preview.plans.quick.skippedChecks].some(
        (check) => check.command === 'vite',
      ),
    ).toBe(false);
  });

  it('provides a human reason and deterministic source references for every decision', () => {
    const plan = createVerificationPlan(profile(), 'quick');

    for (const check of [...plan.selectedChecks, ...plan.skippedChecks]) {
      expect(check.reason.length).toBeGreaterThan(0);
      expect(check.taskCandidateId).toMatch(/^task\.root\./u);
      expect(check.capabilityIds.length).toBeGreaterThan(0);
      expect(check.evidenceIds.length).toBeGreaterThan(0);
    }
    expect(plan.skippedChecks.find((check) => check.kind === 'build')?.reason).toContain(
      'reserved for the Full plan',
    );
    expect(plan.recommendationSource).toBe('deterministic-project-profile');
    expect(plan.profileGeneratedAt).toBe('2026-09-15T00:00:00.000Z');
  });

  it('does not invent a missing check kind', () => {
    const input = profile({ taskCandidates: [task('test', 'vitest run')] });

    const plan = createVerificationPlan(input, 'full');

    expect(plan.selectedChecks.map((check) => check.kind)).toEqual(['test']);
    expect(plan.skippedChecks).toEqual([]);
  });

  it('fails closed for partial, unsupported, and empty profiles', () => {
    const partial = createVerificationPlan(
      profile({ completeness: 'partial', scan: { ...profile().scan, limitsReached: ['entries'] } }),
      'full',
    );
    const unsupported = createVerificationPlan(
      profile({ capabilities: capabilities.filter((item) => item.id !== 'framework.vite') }),
      'full',
    );
    const empty = createVerificationPlan(profile({ taskCandidates: [] }), 'full');

    expect(partial).toMatchObject({ status: 'unavailable', selectedChecks: [] });
    expect(partial.skippedChecks).toHaveLength(4);
    expect(unsupported).toMatchObject({ status: 'unavailable', selectedChecks: [] });
    expect(empty).toMatchObject({
      status: 'unavailable',
      statusReason: 'No evidence-backed verification task candidates were available.',
      selectedChecks: [],
      skippedChecks: [],
    });
  });

  it('skips ambiguous candidates instead of selecting a default', () => {
    const ambiguous = profile({
      taskCandidates: [
        ...profile().taskCandidates,
        task('test', 'vitest run --changed', { id: 'task.root.test.changed' }),
      ],
    });

    const plan = createVerificationPlan(ambiguous, 'full');

    expect(plan.selectedChecks.map((check) => check.kind)).not.toContain('test');
    expect(plan.skippedChecks.filter((check) => check.kind === 'test')).toHaveLength(2);
    expect(plan.skippedChecks.find((check) => check.kind === 'test')?.reason).toContain(
      'does not guess a target',
    );
  });

  it('omits a malformed candidate with no resolvable evidence rather than creating a false plan item', () => {
    const malformed = profile({
      taskCandidates: [task('test', 'vitest run', { evidenceIds: ['missing'] })],
    });

    const plan = createVerificationPlan(malformed, 'full');

    expect(plan).toMatchObject({
      status: 'unavailable',
      statusReason: 'No observed verification task candidate had resolvable source evidence.',
      selectedChecks: [],
      skippedChecks: [],
    });
  });

  it('keeps a partially evidenced candidate skipped with only resolvable source references', () => {
    const malformed = profile({
      taskCandidates: [task('test', 'vitest run', { evidenceIds: ['script.test', 'missing'] })],
    });

    const plan = createVerificationPlan(malformed, 'full');

    expect(plan).toMatchObject({ status: 'unavailable', selectedChecks: [] });
    expect(plan.skippedChecks[0]?.evidenceIds).toEqual(['script.test']);
    expect(plan.skippedChecks[0]?.reason).toContain('source evidence references are missing');
  });

  it('fails closed for duplicate source identifiers that could make evidence ambiguous', () => {
    const input = profile({
      evidence: [...evidence, { ...evidence[0]!, summary: 'A conflicting duplicate.' }],
    });

    const plan = createVerificationPlan(input, 'full');

    expect(plan).toMatchObject({ status: 'unavailable', selectedChecks: [] });
    for (const decision of plan.skippedChecks) {
      expect(decision.evidenceIds.length).toBeGreaterThan(0);
      expect(decision.evidenceIds.every((id) => id !== 'manifest')).toBe(true);
    }
  });

  it('fails closed when required project capabilities have no resolvable evidence', () => {
    for (const invalidEvidenceIds of [[], ['missing']]) {
      const malformed = profile({
        capabilities: capabilities.map((capability) =>
          capability.id === 'framework.vite'
            ? { ...capability, evidenceIds: invalidEvidenceIds }
            : capability,
        ),
      });

      const plan = createVerificationPlan(malformed, 'full');

      expect(plan).toMatchObject({ status: 'unavailable', selectedChecks: [] });
      expect(plan.skippedChecks).toHaveLength(4);
    }
  });

  it('skips a check whose supporting capability has no resolvable evidence', () => {
    for (const invalidEvidenceIds of [[], ['missing']]) {
      const malformed = profile({
        capabilities: capabilities.map((capability) =>
          capability.id === 'linter.eslint'
            ? { ...capability, evidenceIds: invalidEvidenceIds }
            : capability,
        ),
      });

      const plan = createVerificationPlan(malformed, 'full');

      expect(plan.selectedChecks.map((check) => check.kind)).not.toContain('lint');
      expect(plan.skippedChecks.find((check) => check.kind === 'lint')?.reason).toContain(
        'evidence references are missing',
      );
    }
  });
});
