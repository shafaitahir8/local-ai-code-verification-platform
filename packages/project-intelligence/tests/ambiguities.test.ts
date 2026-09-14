import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';
import type { ProjectSensor } from '../src/index.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-profile-ambiguity-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function candidateSensor(options: {
  readonly id: string;
  readonly framework: string;
  readonly testCommand: string;
  readonly runCommand: string;
}): ProjectSensor {
  const evidenceId = `${options.id}.manifest`;
  const workspaceId = `workspace.${options.id}`;
  return {
    id: options.id,
    scan: async () => ({
      capabilities: [
        {
          id: `test-framework.${options.framework}`,
          kind: 'test-framework',
          name: options.framework,
          confidence: 'confirmed',
          evidenceIds: [evidenceId],
        },
      ],
      workspaceUnits: [
        {
          id: workspaceId,
          path: '.',
          name: options.id,
          evidenceIds: [evidenceId],
        },
      ],
      taskCandidates: [
        {
          id: `task.${options.id}.test`,
          kind: 'test',
          label: `Test ${options.id}`,
          command: options.testCommand,
          workingDirectory: '.',
          workspaceId,
          confidence: 'confirmed',
          evidenceIds: [evidenceId],
        },
        {
          id: `task.${options.id}.run`,
          kind: 'run',
          label: `Run ${options.id}`,
          command: options.runCommand,
          workingDirectory: '.',
          workspaceId,
          confidence: 'confirmed',
          evidenceIds: [evidenceId],
        },
      ],
      evidence: [
        {
          id: evidenceId,
          sensorId: options.id,
          kind: 'manifest',
          path: 'project.marker',
          summary: `${options.id} marker is present.`,
        },
      ],
      ambiguities: [],
      warnings: [],
    }),
  };
}

describe('cross-sensor target ambiguity', () => {
  it('reports credible alternatives without selecting a framework, test, or run target', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'project.marker'), 'fixture\n', 'utf8');
    const result = await new FileSystemProjectProfiler({
      sensors: [
        candidateSensor({
          id: 'node-fixture',
          framework: 'jest',
          testCommand: 'npm test',
          runCommand: 'npm start',
        }),
        candidateSensor({
          id: 'python-fixture',
          framework: 'pytest',
          testCommand: 'pytest',
          runCommand: 'python -m app',
        }),
      ],
    }).profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.ambiguities).toEqual([
      expect.objectContaining({
        code: 'MULTIPLE_RUN_TARGETS',
        candidateIds: ['task.node-fixture.run', 'task.python-fixture.run'],
      }),
      expect.objectContaining({
        code: 'MULTIPLE_TEST_FRAMEWORKS',
        candidateIds: ['test-framework.jest', 'test-framework.pytest'],
      }),
      expect.objectContaining({
        code: 'MULTIPLE_TEST_TARGETS',
        candidateIds: ['task.node-fixture.test', 'task.python-fixture.test'],
      }),
    ]);
    expect(result.profile).not.toHaveProperty('selectedWorkspaceId');
    expect(result.profile).not.toHaveProperty('selectedTaskId');
  });

  it('coalesces a sensor ambiguity with the equivalent globally derived ambiguity', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'project.marker'), 'fixture\n', 'utf8');
    const sensor: ProjectSensor = {
      id: 'multi-test',
      scan: async () => ({
        capabilities: [],
        workspaceUnits: [
          {
            id: 'workspace.multi-test',
            path: '.',
            evidenceIds: ['multi-test.manifest'],
          },
        ],
        taskCandidates: [
          {
            id: 'task.multi-test.unit',
            kind: 'test',
            label: 'Unit tests',
            command: 'test-unit',
            workingDirectory: '.',
            workspaceId: 'workspace.multi-test',
            confidence: 'confirmed',
            evidenceIds: ['multi-test.manifest'],
          },
          {
            id: 'task.multi-test.integration',
            kind: 'test',
            label: 'Integration tests',
            command: 'test-integration',
            workingDirectory: '.',
            workspaceId: 'workspace.multi-test',
            confidence: 'confirmed',
            evidenceIds: ['multi-test.manifest'],
          },
        ],
        evidence: [
          {
            id: 'multi-test.manifest',
            sensorId: 'multi-test',
            kind: 'manifest',
            path: 'project.marker',
            summary: 'Two explicit test targets are declared.',
          },
        ],
        ambiguities: [
          {
            code: 'MULTIPLE_TEST_TARGETS',
            message: 'The sensor found multiple test targets.',
            candidateIds: ['task.multi-test.unit', 'task.multi-test.integration'],
            evidenceIds: ['multi-test.manifest'],
          },
        ],
        warnings: [],
      }),
    };

    const result = await new FileSystemProjectProfiler({ sensors: [sensor] }).profile({
      repositoryRoot,
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.ambiguities).toEqual([
      expect.objectContaining({
        code: 'MULTIPLE_TEST_TARGETS',
        candidateIds: ['task.multi-test.integration', 'task.multi-test.unit'],
        evidenceIds: ['multi-test.manifest'],
      }),
    ]);
  });
});
