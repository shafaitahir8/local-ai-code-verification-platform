import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';

const fixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/node-vite-vitest/', import.meta.url),
);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-profile-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function snapshot(
  directory: string,
  relative = '',
): Promise<Readonly<Record<string, string>>> {
  const result: Record<string, string> = {};
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(result, await snapshot(directory, path));
    } else if (entry.isFile()) {
      const content = await readFile(join(directory, ...path.split('/')));
      result[path] = createHash('sha256').update(content).digest('hex');
    }
  }
  return result;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('Node/Vite/Vitest project profiling', () => {
  it('builds a stable evidence-backed profile without changing or executing the fixture', async () => {
    const before = await snapshot(fixtureRoot);
    const progress: string[] = [];
    const profiler = new FileSystemProjectProfiler({
      now: () => 1_000,
      generatedAt: () => new Date('2026-09-12T00:00:00.000Z'),
    });

    const result = await profiler.profile({
      repositoryRoot: fixtureRoot,
      onProgress: (event) => progress.push(event.phase),
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile).toMatchObject({
      profileVersion: 1,
      repositoryRoot: await realpath(fixtureRoot),
      displayName: 'profile-fixture',
      generatedAt: '2026-09-12T00:00:00.000Z',
      completeness: 'complete',
      scan: { limitsReached: [], elapsedMs: 0 },
      workspaceUnits: [
        {
          id: 'workspace.root',
          path: '.',
          name: 'profile-fixture',
          evidenceIds: ['node.manifest.package-json'],
        },
      ],
      ambiguities: [],
      warnings: [],
    });
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual([
      'build-tool.vite',
      'framework.vite',
      'language.typescript',
      'linter.eslint',
      'package-manager.pnpm',
      'runtime.node',
      'test-framework.vitest',
      'typechecker.typescript',
    ]);
    expect(result.profile.capabilities.every(({ confidence }) => confidence === 'confirmed')).toBe(
      true,
    );
    expect(result.profile.taskCandidates.map(({ kind, command }) => ({ kind, command }))).toEqual([
      { kind: 'build', command: 'vite build' },
      { kind: 'lint', command: 'eslint .' },
      { kind: 'run', command: 'vite' },
      { kind: 'test', command: 'vitest run' },
      { kind: 'typecheck', command: 'tsc --noEmit' },
    ]);
    expect(result.profile.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'manifest', path: 'package.json' }),
        expect.objectContaining({ kind: 'lockfile', path: 'pnpm-lock.yaml' }),
        expect.objectContaining({ kind: 'config', path: 'vite.config.ts' }),
        expect.objectContaining({ kind: 'config', path: 'vitest.config.ts' }),
        expect.objectContaining({ kind: 'path', path: 'tests/main.test.ts' }),
      ]),
    );
    expect(progress).toContain('inventory');
    expect(progress).toContain('sensors');
    expect(progress.at(-1)).toBe('finalizing');
    expect(await snapshot(fixtureRoot)).toEqual(before);
  });

  it('does not invent a package manager without declaration or lockfile evidence', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(
      join(repositoryRoot, 'package.json'),
      '{"name":"no-manager","scripts":{"lint":"custom-linter ."}}\n',
      'utf8',
    );

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities.map(({ kind }) => kind)).not.toContain('package-manager');
    expect(result.profile.capabilities.map(({ id }) => id)).not.toContain('linter.eslint');
    expect(result.profile.taskCandidates).toEqual([
      expect.objectContaining({ kind: 'lint', command: 'custom-linter .' }),
    ]);
  });

  it('reports lockfile package-manager evidence even when no manifest can be read', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8');

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual([
      expect.objectContaining({
        id: 'package-manager.pnpm',
        confidence: 'confirmed',
        evidenceIds: ['node.lockfile.pnpm'],
      }),
    ]);
  });

  it('reports a malformed manifest without inventing scripts or tooling', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'package.json'), '{ not-json', 'utf8');

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.taskCandidates).toEqual([]);
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual(['runtime.node']);
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({ code: 'PACKAGE_MANIFEST_INVALID', affectsCompleteness: true }),
    ]);
  });

  it('ignores malformed dependency declarations instead of inventing capabilities', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(
      join(repositoryRoot, 'package.json'),
      JSON.stringify({
        name: 'malformed-dependencies',
        devDependencies: { vite: true, vitest: null, typescript: '' },
      }),
      'utf8',
    );

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual(['runtime.node']);
    expect(result.profile.taskCandidates).toEqual([]);
  });

  it('returns an empty complete profile for a repository with no supported markers', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(join(repositoryRoot, 'README.md'), '# Empty fixture\n', 'utf8');

    const result = await new FileSystemProjectProfiler({ now: () => 0 }).profile({
      repositoryRoot,
    });

    expect(result).toMatchObject({
      status: 'completed',
      profile: {
        completeness: 'complete',
        capabilities: [],
        taskCandidates: [],
        evidence: [],
        warnings: [],
      },
    });
  });
});
