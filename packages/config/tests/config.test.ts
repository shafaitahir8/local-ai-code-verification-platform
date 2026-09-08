import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConfigAlreadyExistsError,
  ConfigNotFoundError,
  ConfigUnsafePathError,
  ConfigValidationError,
  getProjectConfigPath,
  initializeProjectConfig,
  loadProjectConfig,
  parseProjectConfig,
  previewProjectConfig,
  serializeProjectConfig,
  toVerificationSuites,
  validateProjectConfig,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'verify-config-'));
  temporaryDirectories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('project configuration parsing', () => {
  it('parses the documented schema-v1 example', () => {
    const config = parseProjectConfig(`
version: 1
project:
  name: example-project
suites:
  test:
    type: test
    command: npm test
    failure_policy: block
  lint:
    type: lint
    command: npm run lint
    failure_policy: warn
`);

    expect(config).toEqual({
      version: 1,
      project: { name: 'example-project' },
      suites: {
        test: { type: 'test', command: 'npm test', failure_policy: 'block' },
        lint: { type: 'lint', command: 'npm run lint', failure_policy: 'warn' },
      },
    });
  });

  it('applies small, documented defaults for concise manual suites', () => {
    const config = parseProjectConfig(`
version: 1
project:
  name: concise
suites:
  test:
    command: npm test
  lint:
    command: npm run lint
`);

    expect(config.suites).toEqual({
      test: { type: 'test', command: 'npm test', failure_policy: 'block' },
      lint: { type: 'lint', command: 'npm run lint', failure_policy: 'warn' },
    });
  });

  it('reports all actionable validation paths together', () => {
    expect(() =>
      validateProjectConfig({
        version: 2,
        project: { name: '' },
        suites: {
          test: { type: 'test', failure_policy: 'sometimes', timeout_ms: 0 },
        },
      }),
    ).toThrowError(ConfigValidationError);

    try {
      validateProjectConfig({
        version: 2,
        project: { name: '' },
        suites: { test: { failure_policy: 'sometimes', timeout_ms: 0 } },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).issues.map((issue) => issue.path)).toEqual([
        'version',
        'project.name',
        'suites.test.command',
        'suites.test.failure_policy',
        'suites.test.timeout_ms',
      ]);
    }
  });

  it('rejects malformed YAML, duplicate keys, and unsupported fields', () => {
    expect(() => parseProjectConfig('version: [1\n')).toThrow(/YAML parse error/u);
    expect(() =>
      parseProjectConfig('version: 1\nversion: 1\nproject: { name: test }\nsuites: {}\n'),
    ).toThrow(/Map keys must be unique/u);
    expect(() =>
      validateProjectConfig({
        version: 1,
        project: { name: 'test' },
        suites: {},
        telemetry: true,
      }),
    ).toThrow(/telemetry/u);
  });

  it('round-trips commands requiring YAML quoting and exposes domain checks', () => {
    const source = {
      version: 1 as const,
      project: { name: 'quoted' },
      suites: {
        test: {
          type: 'test',
          command: 'node -e "console.log(\'key: value\')"',
          failure_policy: 'block' as const,
          timeout_ms: 5_000,
        },
      },
    };

    const parsed = parseProjectConfig(serializeProjectConfig(source));
    expect(parsed).toEqual(source);
    expect(toVerificationSuites(parsed)).toEqual([
      {
        id: 'test',
        name: 'test',
        type: 'test',
        command: source.suites.test.command,
        failurePolicy: 'block',
        timeoutMs: 5_000,
      },
    ]);
  });
});

describe('safe project configuration filesystem behavior', () => {
  it('loads a config and reports an explicit missing-config error', async () => {
    const root = await temporaryDirectory();

    await expect(loadProjectConfig(root)).rejects.toBeInstanceOf(ConfigNotFoundError);
    await initializeProjectConfig({
      repositoryRoot: root,
      config: { version: 1, project: { name: 'loaded' }, suites: {} },
    });

    await expect(loadProjectConfig(root)).resolves.toMatchObject({
      project: { name: 'loaded' },
    });
  });

  it('creates an explicit discovery preview before writing', async () => {
    const root = await temporaryDirectory();
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: 'previewed', scripts: { test: 'vitest' } }),
      'utf8',
    );

    const preview = await previewProjectConfig(root);

    expect(preview.exists).toBe(false);
    expect(preview.path).toBe(getProjectConfigPath(root));
    expect(preview.suggestedConfig.suites.test?.command).toBe('npm test');
    await expect(readFile(preview.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never overwrites without force and reports explicit replacement', async () => {
    const root = await temporaryDirectory();
    const firstConfig = { version: 1 as const, project: { name: 'first' }, suites: {} };
    const secondConfig = { version: 1 as const, project: { name: 'second' }, suites: {} };

    const created = await initializeProjectConfig({ repositoryRoot: root, config: firstConfig });
    expect(created.overwritten).toBe(false);
    await expect(
      initializeProjectConfig({ repositoryRoot: root, config: secondConfig }),
    ).rejects.toBeInstanceOf(ConfigAlreadyExistsError);
    expect((await loadProjectConfig(root)).project.name).toBe('first');

    const replaced = await initializeProjectConfig({
      repositoryRoot: root,
      config: secondConfig,
      force: true,
    });
    expect(replaced.overwritten).toBe(true);
    expect((await loadProjectConfig(root)).project.name).toBe('second');
  });

  it('refuses to write through a repository-controlled symbolic config directory', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await symlink(
      outside,
      join(root, '.verify'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(
      initializeProjectConfig({
        repositoryRoot: root,
        config: { version: 1, project: { name: 'unsafe' }, suites: {} },
        force: true,
      }),
    ).rejects.toBeInstanceOf(ConfigUnsafePathError);
    await expect(readFile(join(outside, 'project.yml'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
