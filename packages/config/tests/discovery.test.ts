import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSuggestedProjectConfig, discoverProject } from '../src/index.js';

const temporaryDirectories: string[] = [];

async function createProject(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'verify-discovery-'));
  temporaryDirectories.push(root);
  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(join(root, name), contents, 'utf8')),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('discoverProject', () => {
  it('recognizes Node and frontend markers and suggests only real scripts', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({
        name: '@example/web',
        scripts: {
          test: 'vitest',
          lint: 'eslint .',
          build: 'vite build',
          deploy: 'custom deploy',
        },
      }),
      'package-lock.json': '{}',
      'tsconfig.json': '{}',
      'vite.config.ts': 'export default {};',
      'vitest.config.mts': 'export default {};',
    });

    const discovery = await discoverProject(root);

    expect(discovery.projectName).toBe('@example/web');
    expect(discovery.projectTypes).toEqual(['node', 'typescript', 'vite']);
    expect(discovery.markers).toEqual([
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'vitest.config.mts',
    ]);
    expect(discovery.node?.packageManager).toBe('npm');
    expect(
      discovery.suggestedSuites.map(({ id, command, failure_policy }) => ({
        id,
        command,
        failure_policy,
      })),
    ).toEqual([
      { id: 'test', command: 'npm test', failure_policy: 'block' },
      { id: 'lint', command: 'npm run lint', failure_policy: 'warn' },
      { id: 'build', command: 'npm run build', failure_policy: 'block' },
    ]);
    expect(discovery.suggestedSuites.some((suite) => suite.id === 'deploy')).toBe(false);
    expect(discovery.suggestedSuites.some((suite) => suite.id === 'typecheck')).toBe(false);
  });

  it.each([
    ['pnpm@11.0.0', 'pnpm-lock.yaml', 'pnpm run test'],
    ['yarn@4.0.0', 'yarn.lock', 'yarn run test'],
  ] as const)('honors an explicit %s package manager', async (declaration, lockfile, command) => {
    const root = await createProject({
      'package.json': JSON.stringify({
        packageManager: declaration,
        scripts: { test: 'vitest' },
      }),
      [lockfile]: '',
    });

    expect((await discoverProject(root)).suggestedSuites[0]?.command).toBe(command);
  });

  it('does not suggest Node commands for an unsupported declared package manager', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({
        packageManager: 'bun@1.2.0',
        scripts: { test: 'bun test' },
      }),
    });

    const discovery = await discoverProject(root);
    expect(discovery.node?.packageManager).toBeNull();
    expect(discovery.suggestedSuites).toEqual([]);
    expect(discovery.warnings[0]).toMatch(/Unsupported package manager/u);
  });

  it('does not invent checks when package.json is invalid', async () => {
    const root = await createProject({ 'package.json': '{ invalid' });

    const discovery = await discoverProject(root);
    expect(discovery.projectTypes).toContain('node');
    expect(discovery.suggestedSuites).toEqual([]);
    expect(discovery.warnings.join('\n')).toMatch(/Could not parse package\.json/u);
  });

  it.each([
    { name: 'pytest.ini', contents: '[pytest]\n' },
    { name: 'pyproject.toml', contents: '[tool.pytest.ini_options]\naddopts = "-q"\n' },
    { name: 'requirements.txt', contents: 'fastapi\npytest==9.0.0\n' },
  ])('suggests pytest only when $name provides evidence', async ({ name, contents }) => {
    const root = await createProject({ [name]: contents });

    const discovery = await discoverProject(root);
    expect(discovery.projectTypes).toEqual(['python']);
    expect(discovery.python?.pytestDetected).toBe(true);
    expect(discovery.suggestedSuites).toMatchObject([
      { id: 'test', type: 'test', command: 'pytest', failure_policy: 'block' },
    ]);
  });

  it('leaves an uncertain Python project unconfigured', async () => {
    const root = await createProject({ 'pyproject.toml': '[project]\nname = "plain-python"\n' });

    const discovery = await discoverProject(root);
    expect(discovery.python?.pytestDetected).toBe(false);
    expect(discovery.suggestedSuites).toEqual([]);
  });

  it('keeps Node and Python test suggestions distinct in a mixed project', async () => {
    const root = await createProject({
      'package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      'pytest.ini': '[pytest]\n',
    });

    const discovery = await discoverProject(root);
    expect(discovery.suggestedSuites.map((suite) => suite.id)).toEqual(['test', 'pytest']);
    expect(Object.keys(createSuggestedProjectConfig(discovery).suites)).toEqual(['test', 'pytest']);
  });
});
