import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';
import { WorkspaceProjectSensor } from '../src/sensors/workspaces.js';

const npmFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/workspace-npm/', import.meta.url),
);
const pnpmFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/workspace-pnpm/', import.meta.url),
);
const yarnFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/workspace-yarn/', import.meta.url),
);
const ambiguousFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/workspace-ambiguous/', import.meta.url),
);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-workspace-profile-'));
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

function workspaceProfiler(): FileSystemProjectProfiler {
  return new FileSystemProjectProfiler({ sensors: [new WorkspaceProjectSensor()] });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('declared Node workspace profiling', () => {
  it('resolves one npm workspace package without running its observed scripts or writing files', async () => {
    const before = await snapshot(npmFixtureRoot);
    const result = await workspaceProfiler().profile({ repositoryRoot: npmFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual([
      expect.objectContaining({
        id: 'workspace-system.npm',
        kind: 'workspace-system',
        confidence: 'confirmed',
      }),
    ]);
    expect(result.profile.workspaceUnits).toEqual([
      expect.objectContaining({
        path: 'packages/web',
        name: '@fixture/web',
      }),
    ]);
    expect(result.profile.workspaceUnits[0]?.evidenceIds).toEqual(
      expect.arrayContaining([
        'workspace.manifest.package-json-workspaces',
        expect.stringMatching(/^workspace\.manifest\.unit\./u),
      ]),
    );
    const workspaceId = result.profile.workspaceUnits[0]?.id;
    expect(
      result.profile.taskCandidates
        .map(({ kind, workingDirectory, workspaceId: id }) => ({
          kind,
          workingDirectory,
          workspaceId: id,
        }))
        .sort((left, right) => left.kind.localeCompare(right.kind, 'en')),
    ).toEqual([
      { kind: 'build', workingDirectory: 'packages/web', workspaceId },
      { kind: 'run', workingDirectory: 'packages/web', workspaceId },
      { kind: 'test', workingDirectory: 'packages/web', workspaceId },
    ]);
    expect(result.profile.workspaceUnits.map(({ path }) => path)).not.toContain('tools/ignored');
    expect(result.profile.ambiguities).toEqual([]);
    await expect(
      access(join(npmFixtureRoot, 'packages', 'web', 'PROFILE_COMMAND_EXECUTED')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await snapshot(npmFixtureRoot)).toEqual(before);
  });

  it('uses pnpm-workspace.yaml patterns and honors an explicit exclusion', async () => {
    const result = await workspaceProfiler().profile({ repositoryRoot: pnpmFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual([
      expect.objectContaining({
        id: 'workspace-system.pnpm',
      }),
    ]);
    expect(result.profile.capabilities[0]?.evidenceIds).toContain(
      'workspace.config.pnpm-workspace',
    );
    expect(result.profile.workspaceUnits).toEqual([
      expect.objectContaining({ path: 'packages/core', name: '@fixture/core' }),
    ]);
    expect(result.profile.workspaceUnits.map(({ path }) => path)).not.toContain(
      'packages/excluded',
    );
    expect(result.profile.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace.config.pnpm-workspace',
          kind: 'config',
          path: 'pnpm-workspace.yaml',
          pointer: ['packages'],
        }),
      ]),
    );
    expect(result.profile.ambiguities).toEqual([]);
  });

  it('supports the Yarn object form while retaining the declared child target', async () => {
    const result = await workspaceProfiler().profile({ repositoryRoot: yarnFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual([
      expect.objectContaining({ id: 'workspace-system.yarn', confidence: 'confirmed' }),
    ]);
    expect(result.profile.workspaceUnits).toEqual([
      expect.objectContaining({ path: 'apps/site', name: '@fixture/site' }),
    ]);
    expect(result.profile.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace.manifest.package-json-workspaces',
          path: 'package.json',
          pointer: ['workspaces', 'packages'],
        }),
      ]),
    );
    expect(
      result.profile.taskCandidates.map(({ kind, workingDirectory }) => ({
        kind,
        workingDirectory,
      })),
    ).toEqual([
      { kind: 'run', workingDirectory: 'apps/site' },
      { kind: 'test', workingDirectory: 'apps/site' },
    ]);
  });

  it('retains every credible child package and describes workspace ambiguity without a default', async () => {
    const result = await workspaceProfiler().profile({ repositoryRoot: ambiguousFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.workspaceUnits.map(({ path }) => path).sort()).toEqual([
      'packages/api',
      'packages/site',
    ]);
    expect(result.profile.taskCandidates.filter(({ kind }) => kind === 'test')).toHaveLength(2);
    expect(result.profile.taskCandidates.filter(({ kind }) => kind === 'run')).toHaveLength(2);
    expect(result.profile.ambiguities.map(({ code }) => code)).toEqual([
      'MULTIPLE_RUN_TARGETS',
      'MULTIPLE_TEST_TARGETS',
      'MULTIPLE_WORKSPACE_TARGETS',
    ]);
    expect(result.profile.ambiguities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MULTIPLE_TEST_TARGETS',
          candidateIds: result.profile.taskCandidates
            .filter(({ kind }) => kind === 'test')
            .map(({ id }) => id)
            .sort(),
        }),
        expect.objectContaining({
          code: 'MULTIPLE_RUN_TARGETS',
          candidateIds: result.profile.taskCandidates
            .filter(({ kind }) => kind === 'run')
            .map(({ id }) => id)
            .sort(),
        }),
      ]),
    );
    const workspaceAmbiguity = result.profile.ambiguities.find(
      ({ code }) => code === 'MULTIPLE_WORKSPACE_TARGETS',
    );
    expect(workspaceAmbiguity).toMatchObject({
      message: 'Multiple declared workspace package roots remain credible; none is selected.',
      candidateIds: result.profile.workspaceUnits.map(({ id }) => id).sort(),
    });
    expect(workspaceAmbiguity?.evidenceIds).toEqual(
      expect.arrayContaining(
        result.profile.workspaceUnits.flatMap(({ evidenceIds }) => evidenceIds),
      ),
    );
  });

  it('rejects non-contained patterns instead of treating unrelated package manifests as roots', async () => {
    const repositoryRoot = await temporaryDirectory();
    await Promise.all([
      mkdir(join(repositoryRoot, 'packages', 'inside'), { recursive: true }),
      mkdir(join(repositoryRoot, 'other'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(repositoryRoot, 'package.json'),
        JSON.stringify({
          packageManager: 'npm@11.6.0',
          workspaces: ['../outside/*', 'packages/*'],
        }),
        'utf8',
      ),
      writeFile(join(repositoryRoot, 'package-lock.json'), '{}\n', 'utf8'),
      writeFile(join(repositoryRoot, 'packages', 'inside', 'package.json'), '{}\n', 'utf8'),
      writeFile(join(repositoryRoot, 'other', 'package.json'), '{}\n', 'utf8'),
    ]);

    const result = await workspaceProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.workspaceUnits.map(({ path }) => path)).toEqual(['packages/inside']);
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({
        code: 'WORKSPACE_PATTERN_UNSUPPORTED',
        path: 'package.json',
        affectsCompleteness: true,
      }),
    ]);
  });

  it('warns on malformed pnpm workspace metadata without asserting a workspace system', async () => {
    const repositoryRoot = await temporaryDirectory();
    await mkdir(join(repositoryRoot, 'packages', 'inside'), { recursive: true });
    await writeFile(
      join(repositoryRoot, 'pnpm-workspace.yaml'),
      "packages:\n  patterns: ['packages/*']\n",
      'utf8',
    );
    await writeFile(join(repositoryRoot, 'packages', 'inside', 'package.json'), '{}\n', 'utf8');

    const result = await workspaceProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.capabilities).toEqual([]);
    expect(result.profile.workspaceUnits).toEqual([]);
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({
        code: 'PNPM_WORKSPACE_MANIFEST_INVALID',
        path: 'pnpm-workspace.yaml',
        affectsCompleteness: true,
      }),
    ]);
  });

  it('does not confirm a pnpm workspace from an empty packages declaration', async () => {
    const repositoryRoot = await temporaryDirectory();
    await Promise.all([
      writeFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'packages:\n', 'utf8'),
      writeFile(join(repositoryRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8'),
    ]);

    const result = await workspaceProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.capabilities).toEqual([]);
    expect(result.profile.workspaceUnits).toEqual([]);
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({
        code: 'PNPM_WORKSPACE_MANIFEST_INVALID',
        path: 'pnpm-workspace.yaml',
        affectsCompleteness: true,
      }),
    ]);
  });

  it('keeps deterministic workspace IDs distinct for paths that collided under the old hash', async () => {
    const repositoryRoot = await temporaryDirectory();
    const collidingUnderLegacyHash = ['packages/1yqngav-bzt', 'packages/187ewe6-dv2'];
    await Promise.all(
      collidingUnderLegacyHash.map((path) =>
        mkdir(join(repositoryRoot, ...path.split('/')), {
          recursive: true,
        }),
      ),
    );
    await Promise.all([
      writeFile(
        join(repositoryRoot, 'package.json'),
        JSON.stringify({ packageManager: 'npm@11.0.0', workspaces: ['packages/*'] }),
        'utf8',
      ),
      writeFile(join(repositoryRoot, 'package-lock.json'), '{}\n', 'utf8'),
      ...collidingUnderLegacyHash.map((path, index) =>
        writeFile(
          join(repositoryRoot, ...path.split('/'), 'package.json'),
          JSON.stringify({ name: `legacy-collision-${index}` }),
          'utf8',
        ),
      ),
    ]);

    const result = await workspaceProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.workspaceUnits.map(({ path }) => path).sort()).toEqual(
      [...collidingUnderLegacyHash].sort(),
    );
    expect(new Set(result.profile.workspaceUnits.map(({ id }) => id)).size).toBe(2);
    expect(result.profile.warnings.map(({ code }) => code)).not.toContain('SENSOR_FAILED');
  });
});
