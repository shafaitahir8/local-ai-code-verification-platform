import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemProjectProfiler } from '../src/index.js';
import { PythonProjectSensor } from '../src/sensors/python.js';

const pythonFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/python-pytest/', import.meta.url),
);
const malformedFixtureRoot = fileURLToPath(
  new URL('../../../fixtures/project-intelligence/python-malformed/', import.meta.url),
);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-python-profile-'));
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

function pythonProfiler(): FileSystemProjectProfiler {
  return new FileSystemProjectProfiler({
    sensors: [new PythonProjectSensor()],
    now: () => 1_000,
    generatedAt: () => new Date('2026-09-14T00:00:00.000Z'),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('Python and pytest project profiling', () => {
  it('preserves explicit packaging, pytest, and path evidence without inventing a command', async () => {
    const before = await snapshot(pythonFixtureRoot);

    const result = await pythonProfiler().profile({ repositoryRoot: pythonFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile).toMatchObject({
      profileVersion: 1,
      repositoryRoot: await realpath(pythonFixtureRoot),
      displayName: 'python-pytest-fixture',
      generatedAt: '2026-09-14T00:00:00.000Z',
      completeness: 'complete',
      workspaceUnits: [
        {
          id: 'workspace.python.root',
          path: '.',
          name: 'python-pytest-fixture',
        },
      ],
      taskCandidates: [],
      ambiguities: [],
      warnings: [],
    });
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual([
      'language.python',
      'runtime.python',
      'test-framework.pytest',
    ]);
    expect(result.profile.capabilities.every(({ confidence }) => confidence === 'confirmed')).toBe(
      true,
    );
    expect(result.profile.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'manifest', path: 'pyproject.toml' }),
        expect.objectContaining({ kind: 'manifest', path: 'requirements.txt' }),
        expect.objectContaining({ kind: 'manifest', path: 'setup.py' }),
        expect.objectContaining({ kind: 'config', path: 'setup.cfg' }),
        expect.objectContaining({ kind: 'config', path: 'pytest.ini' }),
        expect.objectContaining({ kind: 'path', path: 'tests/test_profile.py' }),
      ]),
    );
    const pytestCapability = result.profile.capabilities.find(
      ({ id }) => id === 'test-framework.pytest',
    );
    const pytestEvidence = result.profile.evidence.filter(({ id }) =>
      pytestCapability?.evidenceIds.includes(id),
    );
    expect(pytestEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'pyproject.toml',
          pointer: ['tool', 'pytest', 'ini_options'],
        }),
        expect.objectContaining({
          path: 'pyproject.toml',
          pointer: ['project', 'optional-dependencies', 'test'],
        }),
        expect.objectContaining({ path: 'requirements.txt', pointer: ['requirements', 'pytest'] }),
        expect.objectContaining({ path: 'setup.cfg', pointer: ['tool:pytest'] }),
        expect.objectContaining({ path: 'pytest.ini', pointer: ['pytest'] }),
        expect.objectContaining({ kind: 'path', path: 'tests/test_profile.py' }),
      ]),
    );
    const after = await snapshot(pythonFixtureRoot);
    expect(after).toEqual(before);
    expect(after).not.toHaveProperty('SETUP_PY_WAS_EXECUTED');
  });

  it('warns on malformed metadata and does not infer pytest from filenames or related packages', async () => {
    const before = await snapshot(malformedFixtureRoot);

    const result = await pythonProfiler().profile({ repositoryRoot: malformedFixtureRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual([
      'language.python',
      'runtime.python',
    ]);
    expect(result.profile.taskCandidates).toEqual([]);
    expect(result.profile.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'path', path: 'tests/test_not_pytest_evidence.py' }),
      ]),
    );
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({ code: 'PYPROJECT_TOML_INVALID', path: 'pyproject.toml' }),
      expect.objectContaining({ code: 'PYTEST_CONFIG_INVALID', path: 'pytest.ini' }),
    ]);
    expect(await snapshot(malformedFixtureRoot)).toEqual(before);
  });

  it('rejects malformed dependency arrays instead of extracting a false pytest signal', async () => {
    const repositoryRoot = await temporaryDirectory();
    await writeFile(
      join(repositoryRoot, 'pyproject.toml'),
      '[project]\nname = "malformed-array"\ndependencies = ["pytest" garbage]\n',
      'utf8',
    );

    const result = await pythonProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.completeness).toBe('partial');
    expect(result.profile.capabilities.map(({ id }) => id)).toEqual([
      'language.python',
      'runtime.python',
    ]);
    expect(result.profile.capabilities.map(({ id }) => id)).not.toContain('test-framework.pytest');
    expect(result.profile.warnings).toEqual([
      expect.objectContaining({ code: 'PYPROJECT_TOML_INVALID', path: 'pyproject.toml' }),
    ]);
  });

  it('does not label JavaScript tests as Python or pytest evidence', async () => {
    const repositoryRoot = await temporaryDirectory();
    await mkdir(join(repositoryRoot, 'tests'));
    await writeFile(join(repositoryRoot, 'tests', 'app.test.js'), 'export {};\n', 'utf8');

    const result = await pythonProfiler().profile({ repositoryRoot });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected a completed profile.');
    expect(result.profile.capabilities).toEqual([]);
    expect(result.profile.evidence).toEqual([]);
  });
});
