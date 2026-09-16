import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyProjectConfigMigration,
  ConfigMigrationStaleError,
  ConfigNotFoundError,
  ConfigUnsafePathError,
  ConfigValidationError,
  getProjectConfigPath,
  loadProjectConfig,
  loadProjectPolicy,
  parseProjectConfigV2,
  previewProjectConfigMigration,
  toVerificationSuites,
} from '../src/index.js';

const roots: string[] = [];

const v1Yaml = `# user comment must survive migration
version: 1
project:
  name: reviewable
suites:
  test:
    command: pnpm test # manual command
  lint:
    type: lint
    command: pnpm lint
    failure_policy: warn
  build:
    type: build
    command: pnpm build
    timeout_ms: 60000
`;

async function makeRoot(source = v1Yaml): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'verify-migration-'));
  roots.push(root);
  await mkdir(join(root, '.verify'));
  await writeFile(getProjectConfigPath(root), source, 'utf8');
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function reconstructDiff(diff: string, kind: 'before' | 'after'): string {
  const lines = diff.split('\n').slice(3, -1);
  return (
    lines
      .filter((line) =>
        kind === 'before'
          ? line.startsWith(' ') || line.startsWith('-')
          : line.startsWith(' ') || line.startsWith('+'),
      )
      .map((line) => line.slice(1))
      .join('\n') + '\n'
  );
}

describe('schema-v2 policy validation', () => {
  const validV2 = `version: 2
project: { name: v2 }
suites:
  test: { type: test, command: pnpm test, failure_policy: block }
plans:
  quick: { suites: [test] }
  full: { suites: [test] }
launch_targets: {}
discovery: { exclusions: [] }
overrides: {}
`;

  it('reads version 2 only through the additive policy parser, keeping v1 strict', async () => {
    const root = await makeRoot(validV2);
    const v2 = parseProjectConfigV2(validV2);

    expect(v2.version).toBe(2);
    expect(v2.plans.quick.suites).toEqual(['test']);
    await expect(loadProjectPolicy(root)).resolves.toEqual(v2);
    await expect(loadProjectConfig(root)).rejects.toBeInstanceOf(ConfigValidationError);
    expect(toVerificationSuites(v2)).toEqual([
      {
        id: 'test',
        name: 'test',
        type: 'test',
        command: 'pnpm test',
        failurePolicy: 'block',
      },
    ]);
  });

  it('rejects unknown suite membership and unsupported nonempty reserved policy', () => {
    expect(() => parseProjectConfigV2(validV2.replace('[test] }', '[missing] }'))).toThrow(
      /unknown suite ID missing/u,
    );
    expect(() =>
      parseProjectConfigV2(validV2.replace('launch_targets: {}', 'launch_targets: { app: {} }')),
    ).toThrow(/non-empty launch targets/u);
    expect(() =>
      parseProjectConfigV2(validV2.replace('exclusions: []', 'exclusions: [node_modules]')),
    ).toThrow(/non-empty exclusions/u);
    expect(() =>
      parseProjectConfigV2(validV2.replace('overrides: {}', 'overrides: { package: web }')),
    ).toThrow(/non-empty overrides/u);
    expect(() =>
      parseProjectConfigV2(
        validV2.replace('full: { suites: [test] }', 'full: { suites: [test, test] }'),
      ),
    ).toThrow(/duplicates suite ID test/u);
  });
});

describe('explicit v1-to-v2 migration', () => {
  it('previews a deterministic exact diff without writing, preserving comments and suites', async () => {
    const root = await makeRoot();
    const path = getProjectConfigPath(root);
    const before = await readFile(path, 'utf8');
    const initialFiles = await readdir(join(root, '.verify'));

    const first = await previewProjectConfigMigration(root);
    const second = await previewProjectConfigMigration(root);

    expect(first).toEqual(second);
    expect(first.sourceVersion).toBe(1);
    expect(first.targetVersion).toBe(2);
    expect(first.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.targetDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.summary).toMatch(/does not approve or execute commands/u);
    expect(first.targetYaml).toContain('# user comment must survive migration');
    expect(first.targetYaml).toContain('pnpm test # manual command');
    expect(first.diff).toMatch(
      /^--- a\/\.verify\/project\.yml\n\+\+\+ b\/\.verify\/project\.yml\n@@/u,
    );
    expect(reconstructDiff(first.diff, 'before')).toBe(before);
    expect(reconstructDiff(first.diff, 'after')).toBe(first.targetYaml);
    expect(parseProjectConfigV2(first.targetYaml).plans).toEqual({
      quick: { suites: ['test', 'lint'] },
      full: { suites: ['test', 'lint', 'build'] },
    });
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(await readdir(join(root, '.verify'))).toEqual(initialFiles);
  });

  it('retains CRLF bytes in the proposed YAML and exact diff', async () => {
    const source = v1Yaml.replace(/\n/gu, '\r\n');
    const root = await makeRoot(source);
    const preview = await previewProjectConfigMigration(root);

    expect(preview.targetYaml).toContain('\r\n');
    expect(preview.targetYaml.replace(/\r\n/gu, '')).not.toContain('\n');
    expect(reconstructDiff(preview.diff, 'before')).toBe(source);
    expect(reconstructDiff(preview.diff, 'after')).toBe(preview.targetYaml);
  });

  it('marks a source without a final newline in the exact diff', async () => {
    const root = await makeRoot(v1Yaml.trimEnd());
    const preview = await previewProjectConfigMigration(root);

    expect(preview.diff).toContain('\\ No newline at end of file');
    expect(await readFile(preview.path, 'utf8')).toBe(v1Yaml.trimEnd());
  });

  it('applies only after digest acceptance and exposes v2 without changing suite execution semantics', async () => {
    const root = await makeRoot();
    const preview = await previewProjectConfigMigration(root);
    const before = await loadProjectConfig(root);
    const result = await applyProjectConfigMigration({
      repositoryRoot: root,
      expectedSourceDigest: preview.sourceDigest,
      expectedTargetDigest: preview.targetDigest,
    });

    expect(result).toEqual({
      path: preview.path,
      version: 2,
      sourceDigest: preview.sourceDigest,
      targetDigest: preview.targetDigest,
      config: parseProjectConfigV2(preview.targetYaml),
    });
    expect(await readFile(preview.path, 'utf8')).toBe(preview.targetYaml);
    expect(await readdir(join(root, '.verify'))).toEqual(['project.yml']);
    expect((await loadProjectPolicy(root)).version).toBe(2);
    expect(toVerificationSuites(result.config)).toEqual(toVerificationSuites(before));
    await expect(previewProjectConfigMigration(root)).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('rejects comment-only and malformed intervening edits as stale without writing', async () => {
    const root = await makeRoot();
    const preview = await previewProjectConfigMigration(root);
    const altered = `${v1Yaml}# manual comment\n`;
    await writeFile(preview.path, altered, 'utf8');

    await expect(
      applyProjectConfigMigration({
        repositoryRoot: root,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_STALE', digestKind: 'source' });
    expect(await readFile(preview.path, 'utf8')).toBe(altered);
    expect(await readdir(join(root, '.verify'))).toEqual(['project.yml']);

    await writeFile(preview.path, 'version: [1\n', 'utf8');
    await expect(
      applyProjectConfigMigration({
        repositoryRoot: root,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      }),
    ).rejects.toBeInstanceOf(ConfigMigrationStaleError);
  });

  it('rejects a different target revision without writing the source', async () => {
    const root = await makeRoot();
    const preview = await previewProjectConfigMigration(root);

    await expect(
      applyProjectConfigMigration({
        repositoryRoot: root,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_STALE', digestKind: 'target' });
    expect(await readFile(preview.path, 'utf8')).toBe(v1Yaml);
    expect(await readdir(join(root, '.verify'))).toEqual(['project.yml']);
  });

  it('fails safely on malformed, missing, unsupported, or symbolic sources', async () => {
    const malformed = await makeRoot('version: [1\n');
    await expect(previewProjectConfigMigration(malformed)).rejects.toBeInstanceOf(
      ConfigValidationError,
    );
    const unsupported = await makeRoot('version: 3\nproject: { name: other }\nsuites: {}\n');
    await expect(previewProjectConfigMigration(unsupported)).rejects.toBeInstanceOf(
      ConfigValidationError,
    );
    const missing = await mkdtemp(join(tmpdir(), 'verify-migration-missing-'));
    roots.push(missing);
    await expect(previewProjectConfigMigration(missing)).rejects.toBeInstanceOf(
      ConfigNotFoundError,
    );

    const sourceRoot = await makeRoot();
    const linkedRoot = await mkdtemp(join(tmpdir(), 'verify-migration-linked-'));
    roots.push(linkedRoot);
    await symlink(
      join(sourceRoot, '.verify'),
      join(linkedRoot, '.verify'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(previewProjectConfigMigration(linkedRoot)).rejects.toBeInstanceOf(
      ConfigUnsafePathError,
    );

    // Creating a file link requires an elevated Windows token on this runner. The directory-link
    // case above remains covered on Windows through a junction; test file links where supported.
    if (process.platform !== 'win32') {
      const fileLinkRoot = await mkdtemp(join(tmpdir(), 'verify-migration-file-linked-'));
      roots.push(fileLinkRoot);
      await mkdir(join(fileLinkRoot, '.verify'));
      await symlink(getProjectConfigPath(sourceRoot), getProjectConfigPath(fileLinkRoot), 'file');
      await expect(previewProjectConfigMigration(fileLinkRoot)).rejects.toBeInstanceOf(
        ConfigUnsafePathError,
      );
    }
  });
});
