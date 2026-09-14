import type { ProjectProfile } from '@verify/domain';
import { describe, expect, it } from 'vitest';

import { formatProjectProfile } from '../src/format.js';

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
