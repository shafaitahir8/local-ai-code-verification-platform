import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';

const viteFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/node-vite-vitest/', import.meta.url),
);
const jestFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/node-jest/', import.meta.url),
);
const staticFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/plain-static/', import.meta.url),
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
    const before = await snapshot(viteFixtureRoot);
    const progress: string[] = [];
    const profiler = new FileSystemProjectProfiler({
      now: () => 1_000,
      generatedAt: () => new Date('2026-09-12T00:00:00.000Z'),
    });

    const result = await profiler.profile({
      repositoryRoot: viteFixtureRoot,
      onProgress: (event) => progress.push(event.phase),
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile).toMatchObject({
      profileVersion: 1,
      repositoryRoot: await realpath(viteFixtureRoot),
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
    expect(result.profile.capabilities.map(({ id }) => id)).not.toContain('preview.static-html');
    expect(await snapshot(viteFixtureRoot)).toEqual(before);
  });

  it('keeps Vite classification when an explicit root index.html is present', async () => {
    const result = await new FileSystemProjectProfiler().profile({
      repositoryRoot: viteFixtureRoot,
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.evidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'index.html' })]),
    );
    expect(result.profile.capabilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'framework.vite' })]),
    );
    expect(result.profile.capabilities.map(({ id }) => id)).not.toContain('preview.static-html');
  });

  it('treats a direct Vite script as conflicting framework evidence for a root index.html', async () => {
    const repositoryRoot = await temporaryDirectory();
    await Promise.all([
      writeFile(join(repositoryRoot, 'index.html'), '<!doctype html>\n', 'utf8'),
      writeFile(
        join(repositoryRoot, 'package.json'),
        JSON.stringify({ name: 'script-only-vite', scripts: { dev: 'vite' } }),
        'utf8',
      ),
    ]);

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'framework.vite', confidence: 'confirmed' }),
      ]),
    );
    expect(result.profile.capabilities.map(({ id }) => id)).not.toContain('preview.static-html');
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
        devDependencies: { jest: false, vite: true, vitest: null, typescript: '' },
      }),
      'utf8',
    );

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual(['runtime.node']);
    expect(result.profile.taskCandidates).toEqual([]);
  });

  it('does not infer Jest from a conventional test path alone', async () => {
    const repositoryRoot = await temporaryDirectory();
    await mkdir(join(repositoryRoot, 'tests'));
    await writeFile(join(repositoryRoot, 'tests', 'main.test.js'), 'export {};\n', 'utf8');

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    const observedPathEvidence = result.profile.evidence.filter(
      ({ kind, path }) => kind === 'path' && path === 'tests/main.test.js',
    );
    expect(observedPathEvidence.some(({ id }) => id.startsWith('node.path.javascript.'))).toBe(
      true,
    );
    expect(observedPathEvidence.some(({ id }) => id.startsWith('node.path.test.'))).toBe(true);
    expect(result.profile.capabilities).toEqual([
      expect.objectContaining({
        id: 'language.javascript',
        kind: 'language',
        confidence: 'tentative',
      }),
    ]);
    expect(result.profile.capabilities.map(({ id }) => id)).not.toContain('test-framework.jest');
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

describe('Node/Jest project profiling', () => {
  it('detects explicit Jest signals and preserves the fixture byte for byte', async () => {
    const before = await snapshot(jestFixtureRoot);
    const result = await new FileSystemProjectProfiler({
      now: () => 1_000,
      generatedAt: () => new Date('2026-09-13T00:00:00.000Z'),
    }).profile({ repositoryRoot: jestFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile).toMatchObject({
      profileVersion: 1,
      repositoryRoot: await realpath(jestFixtureRoot),
      displayName: 'jest-profile-fixture',
      generatedAt: '2026-09-13T00:00:00.000Z',
      completeness: 'complete',
      ambiguities: [],
      warnings: [],
    });
    expect(result.profile.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'package-manager.npm',
          kind: 'package-manager',
          confidence: 'confirmed',
        }),
        expect.objectContaining({
          id: 'runtime.node',
          kind: 'runtime',
          confidence: 'confirmed',
        }),
        expect.objectContaining({
          id: 'test-framework.jest',
          kind: 'test-framework',
          confidence: 'confirmed',
        }),
      ]),
    );
    const jestCapability = result.profile.capabilities.find(
      ({ id }) => id === 'test-framework.jest',
    );
    const jestCapabilityEvidence = result.profile.evidence.filter(({ id }) =>
      jestCapability?.evidenceIds.includes(id),
    );
    expect(jestCapabilityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'config', path: 'jest.config.ts' }),
        expect.objectContaining({
          kind: 'manifest',
          path: 'package.json',
          pointer: ['devDependencies', 'jest'],
        }),
        expect.objectContaining({
          kind: 'script',
          path: 'package.json',
          pointer: ['scripts', 'test'],
        }),
        expect.objectContaining({ kind: 'path', path: 'tests/sum.test.js' }),
      ]),
    );
    expect(result.profile.taskCandidates).toEqual([
      expect.objectContaining({ kind: 'test', command: 'jest --runInBand' }),
    ]);
    expect(result.profile.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'config', path: 'jest.config.ts' }),
        expect.objectContaining({ kind: 'lockfile', path: 'package-lock.json' }),
        expect.objectContaining({
          kind: 'manifest',
          path: 'package.json',
          pointer: ['devDependencies', 'jest'],
        }),
        expect.objectContaining({
          kind: 'script',
          path: 'package.json',
          pointer: ['scripts', 'test'],
        }),
        expect.objectContaining({ kind: 'path', path: 'tests/sum.test.js' }),
      ]),
    );
    expect(await snapshot(jestFixtureRoot)).toEqual(before);
  });

  it('uses a direct Jest test script as confirmed evidence without a dependency or config', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(
      join(repositoryRoot, 'package.json'),
      JSON.stringify({ name: 'script-only-jest', scripts: { test: 'jest --runInBand' } }),
      'utf8',
    );

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    const jestCapability = result.profile.capabilities.find(
      ({ id }) => id === 'test-framework.jest',
    );
    expect(jestCapability).toMatchObject({
      kind: 'test-framework',
      confidence: 'confirmed',
    });
    expect(
      result.profile.evidence.filter(({ id }) => jestCapability?.evidenceIds.includes(id)),
    ).toEqual([
      expect.objectContaining({
        kind: 'script',
        path: 'package.json',
        pointer: ['scripts', 'test'],
      }),
    ]);
  });
});

describe('plain static-site profiling', () => {
  it('detects a confirmed root HTML preview without inventing a command or changing the fixture', async () => {
    const before = await snapshot(staticFixtureRoot);
    const result = await new FileSystemProjectProfiler({
      now: () => 1_000,
      generatedAt: () => new Date('2026-09-13T00:00:00.000Z'),
    }).profile({ repositoryRoot: staticFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile).toMatchObject({
      profileVersion: 1,
      repositoryRoot: await realpath(staticFixtureRoot),
      generatedAt: '2026-09-13T00:00:00.000Z',
      completeness: 'complete',
      capabilities: [
        {
          id: 'preview.static-html',
          kind: 'preview',
          name: 'Static HTML',
          confidence: 'confirmed',
          evidenceIds: ['node.manifest.static-root-index-html'],
        },
      ],
      taskCandidates: [],
      ambiguities: [],
      warnings: [],
    });
    expect(result.profile.evidence).toEqual([
      expect.objectContaining({ kind: 'manifest', path: 'index.html' }),
    ]);
    expect(await snapshot(staticFixtureRoot)).toEqual(before);
  });

  it('does not claim a plain static site when malformed Node metadata leaves Vite ambiguous', async () => {
    const repositoryRoot = await temporaryDirectory();
    await Promise.all([
      writeFile(join(repositoryRoot, 'index.html'), '<!doctype html>\n', 'utf8'),
      writeFile(join(repositoryRoot, 'package.json'), '{ not-json', 'utf8'),
    ]);

    const result = await new FileSystemProjectProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual(['runtime.node']);
    expect(result.profile.capabilities.map(({ id }) => id)).not.toContain('preview.static-html');
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({ code: 'PACKAGE_MANIFEST_INVALID', affectsCompleteness: true }),
    ]);
  });
});
