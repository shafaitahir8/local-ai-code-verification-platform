import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// Force the failure precisely after the synced sibling temporary file is created. The source
// must remain unchanged and the migration temporary file must be removed.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: vi.fn(async () => {
      throw Object.assign(new Error('simulated replace failure'), { code: 'EACCES' });
    }),
  };
});

import {
  applyProjectConfigMigration,
  getProjectConfigPath,
  previewProjectConfigMigration,
} from '../src/index.js';

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

it('keeps the original valid policy and cleans the sibling temporary file when replacement fails', async () => {
  root = await mkdtemp(join(tmpdir(), 'verify-migration-failure-'));
  await mkdir(join(root, '.verify'));
  const source = 'version: 1\nproject: { name: intact }\nsuites: {}\n';
  const path = getProjectConfigPath(root);
  await writeFile(path, source, 'utf8');
  const preview = await previewProjectConfigMigration(root);

  await expect(
    applyProjectConfigMigration({
      repositoryRoot: root,
      expectedSourceDigest: preview.sourceDigest,
      expectedTargetDigest: preview.targetDigest,
    }),
  ).rejects.toThrow('simulated replace failure');

  expect(await readFile(path, 'utf8')).toBe(source);
  expect(await readdir(join(root, '.verify'))).toEqual(['project.yml']);
});
