import { describe, expect, it } from 'vitest';

import {
  PROJECT_CAPABILITY_KINDS,
  PROJECT_EVIDENCE_KINDS,
  PROJECT_PROFILE_CONFIDENCE_LEVELS,
  PROJECT_PROFILE_VERSION,
  PROJECT_SCAN_LIMITS,
  PROJECT_TASK_KINDS,
} from '../src/index.js';
import type { ProjectProfile, ProjectProfileResult } from '../src/index.js';

const profile: ProjectProfile = {
  profileVersion: PROJECT_PROFILE_VERSION,
  repositoryRoot: '/repo',
  displayName: 'example',
  generatedAt: '2026-09-12T00:00:00.000Z',
  completeness: 'complete',
  scan: {
    entriesScanned: 2,
    filesScanned: 1,
    directoriesScanned: 1,
    bytesRead: 42,
    skippedDirectories: 0,
    elapsedMs: 1,
    limitsReached: [],
  },
  capabilities: [
    {
      id: 'node.runtime.node',
      kind: 'runtime',
      name: 'Node.js',
      confidence: 'confirmed',
      evidenceIds: ['node.manifest.package-json'],
    },
  ],
  workspaceUnits: [
    {
      id: 'workspace.root',
      path: '.',
      name: 'example',
      evidenceIds: ['node.manifest.package-json'],
    },
  ],
  taskCandidates: [],
  evidence: [
    {
      id: 'node.manifest.package-json',
      sensorId: 'node',
      kind: 'manifest',
      path: 'package.json',
      summary: 'Node package manifest is present.',
    },
  ],
  ambiguities: [],
  warnings: [],
};

describe('project profile domain contract', () => {
  it('keeps the first profile version and portable enumerations explicit', () => {
    expect(PROJECT_PROFILE_VERSION).toBe(1);
    expect(PROJECT_PROFILE_CONFIDENCE_LEVELS).toEqual(['confirmed', 'strong', 'tentative']);
    expect(PROJECT_EVIDENCE_KINDS).toContain('manifest');
    expect(PROJECT_CAPABILITY_KINDS).toContain('test-framework');
    expect(PROJECT_TASK_KINDS).toEqual(['test', 'build', 'lint', 'typecheck', 'run', 'preview']);
    expect(PROJECT_SCAN_LIMITS).toContain('elapsed-time');
  });

  it('distinguishes completed partial profiles from cancellation without a profile', () => {
    const partial: ProjectProfileResult = {
      status: 'completed',
      profile: {
        ...profile,
        completeness: 'partial',
        scan: { ...profile.scan, limitsReached: ['entries'] },
      },
    };
    const cancelled: ProjectProfileResult = { status: 'cancelled' };

    expect(partial.status).toBe('completed');
    expect(partial).toHaveProperty('profile.completeness', 'partial');
    expect(cancelled).toEqual({ status: 'cancelled' });
    expect(cancelled).not.toHaveProperty('profile');
  });
});
