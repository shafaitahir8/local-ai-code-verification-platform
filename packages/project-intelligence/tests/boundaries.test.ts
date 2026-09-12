import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';
import type { ProjectSensor } from '../src/index.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-profile-boundary-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('bounded profiling and cancellation', () => {
  it('returns a partial completed profile when the entry budget is reached', async () => {
    const repositoryRoot = await temporaryDirectory();
    await Promise.all([
      writeFile(join(repositoryRoot, 'a.txt'), 'a', 'utf8'),
      writeFile(join(repositoryRoot, 'b.txt'), 'b', 'utf8'),
    ]);

    const result = await new FileSystemProjectProfiler({ limits: { maxEntries: 1 } }).profile({
      repositoryRoot,
    });

    expect(result).toMatchObject({
      status: 'completed',
      profile: {
        completeness: 'partial',
        scan: { entriesScanned: 1, limitsReached: ['entries'] },
        warnings: [expect.objectContaining({ code: 'SCAN_LIMIT_REACHED' })],
      },
    });
  });

  it('returns a partial completed profile when a metadata file exceeds its read budget', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'package.json'), '{"name":"larger-than-limit"}', 'utf8');

    const result = await new FileSystemProjectProfiler({ limits: { maxFileBytes: 4 } }).profile({
      repositoryRoot,
    });

    expect(result).toMatchObject({
      status: 'completed',
      profile: {
        completeness: 'partial',
        scan: { bytesRead: 0, limitsReached: ['file-bytes'] },
      },
    });
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.warnings.map(({ code }) => code)).toEqual([
      'METADATA_FILE_TOO_LARGE',
      'SCAN_LIMIT_REACHED',
    ]);
  });

  it('distinguishes cancellation before and during traversal from partial completion', async () => {
    const repositoryRoot = await temporaryDirectory();
    await mkdir(join(repositoryRoot, 'src'));
    await writeFile(join(repositoryRoot, 'src', 'index.ts'), 'export {};', 'utf8');
    const preCancelled = new AbortController();
    preCancelled.abort();
    await expect(
      new FileSystemProjectProfiler().profile({
        repositoryRoot,
        signal: preCancelled.signal,
      }),
    ).resolves.toEqual({ status: 'cancelled' });

    const active = new AbortController();
    const result = await new FileSystemProjectProfiler().profile({
      repositoryRoot,
      signal: active.signal,
      onProgress: ({ phase }) => {
        if (phase === 'inventory') active.abort();
      },
    });
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('isolates invalid or failed sensors as warnings and exposes only restricted inputs', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'package.json'), '{}', 'utf8');
    await writeFile(join(repositoryRoot, 'test.config.ts'), 'export {};', 'utf8');
    let contextKeys: string[] = [];
    const inspectingSensor: ProjectSensor = {
      id: 'inspect-context',
      scan: async (context) => {
        contextKeys = Object.keys(context).sort();
        return {
          capabilities: [
            {
              id: 'test-files',
              kind: 'test-framework',
              name: 'Evidence-backed tests',
              confidence: 'strong',
              evidenceIds: ['test-path', 'test-config'],
            },
          ],
          workspaceUnits: [],
          taskCandidates: [],
          evidence: [
            {
              id: 'test-path',
              sensorId: 'inspect-context',
              kind: 'path',
              path: 'package.json',
              summary: 'First independent path signal.',
            },
            {
              id: 'test-config',
              sensorId: 'inspect-context',
              kind: 'convention',
              path: 'test.config.ts',
              summary: 'Second independent path signal.',
            },
          ],
          ambiguities: [],
          warnings: [],
        };
      },
    };
    const invalidSensor: ProjectSensor = {
      id: 'invalid',
      scan: async () => ({
        capabilities: [
          {
            id: 'invented',
            kind: 'framework',
            name: 'Invented',
            confidence: 'confirmed',
            evidenceIds: ['path-only'],
          },
        ],
        workspaceUnits: [],
        taskCandidates: [],
        evidence: [
          {
            id: 'path-only',
            sensorId: 'invalid',
            kind: 'path',
            path: 'package.json',
            summary: 'A convention cannot support confirmed confidence.',
          },
        ],
        ambiguities: [],
        warnings: [],
      }),
    };

    const result = await new FileSystemProjectProfiler({
      sensors: [inspectingSensor, invalidSensor],
    }).profile({ repositoryRoot });

    expect(contextKeys).toEqual([
      'inventory',
      'metadata',
      'onProgress',
      'repositoryRoot',
      'signal',
    ]);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({ code: 'SENSOR_FAILED', sensorId: 'invalid' }),
    ]);
    expect(result.profile.capabilities).toEqual([
      expect.objectContaining({ id: 'test-files', confidence: 'strong' }),
    ]);
  });
});
