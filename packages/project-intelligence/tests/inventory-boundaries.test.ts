import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';
import type { ProjectSensor } from '../src/index.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-profile-inventory-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('repository inventory boundaries', () => {
  it('excludes generated, dependency, environment, and VCS directories', async () => {
    const repositoryRoot = await temporaryDirectory();
    const excluded = [
      '.git',
      '.next',
      '.turbo',
      '.venv',
      '__pycache__',
      'build',
      'coverage',
      'dist',
      'node_modules',
      'target',
      'venv',
    ];
    for (const directory of excluded) {
      await mkdir(join(repositoryRoot, directory));
      await writeFile(join(repositoryRoot, directory, 'package.json'), '{}\n', 'utf8');
      await writeFile(join(repositoryRoot, directory, 'pyproject.toml'), '[project]\n', 'utf8');
    }
    await writeFile(join(repositoryRoot, 'README.md'), '# Inventory boundary\n', 'utf8');

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual([]);
    expect(result.profile.evidence).toEqual([]);
    expect(result.profile.scan.skippedDirectories).toBe(excluded.length);
  });

  it('does not follow a directory link outside the repository', async () => {
    const repositoryRoot = await temporaryDirectory();
    const outsideRoot = await temporaryDirectory();
    await writeFile(
      join(outsideRoot, 'package.json'),
      JSON.stringify({ devDependencies: { vite: '7.1.7' } }),
      'utf8',
    );
    await symlink(
      outsideRoot,
      join(repositoryRoot, 'linked-project'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual([]);
    expect(result.profile.evidence).toEqual([]);
    expect(result.profile.scan.skippedDirectories).toBe(1);
  });

  it('reports aggregate metadata exhaustion as partial rather than reading beyond the budget', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'a.txt'), 'aaaa', 'utf8');
    await writeFile(join(repositoryRoot, 'b.txt'), 'bbbb', 'utf8');
    const reads: Array<string | null> = [];
    const readerSensor: ProjectSensor = {
      id: 'aggregate-reader',
      scan: async (context) => {
        reads.push((await context.metadata.readText('a.txt'))?.text ?? null);
        reads.push((await context.metadata.readText('b.txt'))?.text ?? null);
        return {
          capabilities: [],
          workspaceUnits: [],
          taskCandidates: [],
          evidence: [],
          ambiguities: [],
          warnings: [],
        };
      },
    };

    const result = await new FileSystemProjectProfiler({
      sensors: [readerSensor],
      limits: { maxTotalBytes: 5 },
    }).profile({ repositoryRoot });

    expect(reads).toEqual(['aaaa', null]);
    expect(result).toMatchObject({
      status: 'completed',
      profile: {
        completeness: 'partial',
        scan: { bytesRead: 4, limitsReached: ['aggregate-bytes'] },
        warnings: [
          expect.objectContaining({ code: 'METADATA_BUDGET_REACHED' }),
          expect.objectContaining({ code: 'SCAN_LIMIT_REACHED' }),
        ],
      },
    });
  });

  it('reports deterministic elapsed-time exhaustion as a partial scan', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'package.json'), '{}\n', 'utf8');
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(1);

    const result = await new FileSystemProjectProfiler({
      sensors: [],
      limits: { maxElapsedMs: 1 },
      now,
    }).profile({ repositoryRoot });

    expect(result).toMatchObject({
      status: 'completed',
      profile: {
        completeness: 'partial',
        scan: { entriesScanned: 0, elapsedMs: 1, limitsReached: ['elapsed-time'] },
        warnings: [expect.objectContaining({ code: 'SCAN_LIMIT_REACHED' })],
      },
    });
  });
});
