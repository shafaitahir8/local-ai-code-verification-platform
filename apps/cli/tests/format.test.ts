import type { ProjectProfile, VerificationPlanPreview } from '@verify/domain';
import { describe, expect, it } from 'vitest';

import { formatProjectProfile, formatVerificationPlanPreview } from '../src/format.js';

const profile: ProjectProfile = {
  profileVersion: 1,
  repositoryRoot: 'C:\\work\\workspace-project',
  displayName: 'workspace-project',
  generatedAt: '2026-09-14T00:00:00.000Z',
  completeness: 'complete',
  scan: {
    entriesScanned: 4,
    filesScanned: 3,
    directoriesScanned: 1,
    bytesRead: 256,
    skippedDirectories: 0,
    elapsedMs: 2,
    limitsReached: [],
  },
  capabilities: [],
  workspaceUnits: [
    {
      id: 'workspace.npm.packages-web',
      path: 'packages/web',
      name: '@sample/web',
      evidenceIds: ['workspace:npm:packages-web'],
    },
    {
      id: 'workspace.npm.packages-api',
      path: 'packages/api',
      evidenceIds: ['workspace:npm:packages-api'],
    },
  ],
  taskCandidates: [],
  evidence: [],
  ambiguities: [],
  warnings: [],
};

describe('formatProjectProfile', () => {
  it('shows detected workspace units and their evidence without selecting a default', () => {
    const output = formatProjectProfile(profile);

    expect(output).toContain('Detected workspace units:');
    expect(output).toContain('  @sample/web: packages/web (evidence: workspace:npm:packages-web)');
    expect(output).toContain(
      '  workspace.npm.packages-api: packages/api (evidence: workspace:npm:packages-api)',
    );
    expect(output).not.toMatch(/selected|default/u);
  });
});

describe('formatVerificationPlanPreview', () => {
  it('shows Quick and Full selections, skips, reasons, and deterministic sources', () => {
    const testDecision = {
      taskCandidateId: 'task.test',
      kind: 'test',
      label: 'Run Vitest',
      command: 'vitest run',
      workingDirectory: '.',
      confidence: 'confirmed',
      capabilityIds: ['test-framework.vitest'],
      evidenceIds: ['package.script.test'],
      reason: 'Selected from one confirmed Vitest task.',
    } as const;
    const buildDecision = {
      taskCandidateId: 'task.build',
      kind: 'build',
      label: 'Build with Vite',
      command: 'vite build',
      workingDirectory: '.',
      confidence: 'confirmed',
      capabilityIds: ['build-tool.vite'],
      evidenceIds: ['package.script.build'],
      reason: 'Skipped in Quick mode; the build task is reserved for the Full plan.',
    } as const;
    const basePlan = {
      planVersion: 1,
      status: 'ready',
      statusReason: 'Evidence-backed checks are available.',
      repositoryRoot: profile.repositoryRoot,
      profileVersion: 1,
      profileGeneratedAt: profile.generatedAt,
      profileCompleteness: 'complete',
      recommendationSource: 'deterministic-project-profile',
    } as const;
    const preview: VerificationPlanPreview = {
      profile,
      plans: {
        quick: {
          ...basePlan,
          mode: 'quick',
          selectedChecks: [testDecision],
          skippedChecks: [buildDecision],
        },
        full: {
          ...basePlan,
          mode: 'full',
          selectedChecks: [testDecision, { ...buildDecision, reason: 'Selected for Full.' }],
          skippedChecks: [],
        },
      },
    };

    const output = formatVerificationPlanPreview(preview);

    expect(output).toContain('Verification Plan Preview (read-only)');
    expect(output).toContain('Quick plan: READY');
    expect(output).toContain('Full plan: READY');
    expect(output).toContain('test: Run Vitest — vitest run');
    expect(output).toContain('build: Build with Vite — vite build');
    expect(output).toContain(`Reason: ${buildDecision.reason}`);
    expect(output).toContain('Source: task task.test; capabilities: test-framework.vitest');
    expect(output).toContain('Evidence: package.script.test');
  });
});
