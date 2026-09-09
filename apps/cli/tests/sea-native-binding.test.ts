import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createSqliteRunRepository } from '@verify/storage';
import { afterEach, describe, expect, it } from 'vitest';

import { cacheEmbeddedNativeAsset, loadSqliteNativeBinding } from '../src/sea-native-binding.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('SEA SQLite native binding bootstrap', () => {
  it('atomically caches content-addressed addon bytes and repairs a corrupt cache entry', async () => {
    const cacheDirectory = await mkdtemp(join(tmpdir(), 'verify-sea-cache-'));
    temporaryDirectories.push(cacheDirectory);
    const bytes = Buffer.from('native-addon-fixture');

    const first = cacheEmbeddedNativeAsset(bytes, { cacheDirectory });
    const second = cacheEmbeddedNativeAsset(bytes, { cacheDirectory });
    expect(second).toBe(first);
    expect(readFileSync(first)).toStrictEqual(bytes);

    writeFileSync(first, 'corrupt');
    const repaired = cacheEmbeddedNativeAsset(bytes, { cacheDirectory });
    expect(repaired).toBe(first);
    expect(readFileSync(repaired)).toStrictEqual(bytes);
  });

  it.runIf(process.platform === 'win32' && process.arch === 'x64')(
    'loads the packaged Windows addon object through the storage composition boundary',
    () => {
      const require = createRequire(import.meta.url);
      const packageRoot = resolve(dirname(require.resolve('better-sqlite3')), '..');
      const addonPath = join(packageRoot, 'prebuilds', 'win32-x64.node');
      expect(existsSync(addonPath)).toBe(true);

      const repository = createSqliteRunRepository({
        databasePath: ':memory:',
        nativeBinding: loadSqliteNativeBinding(addonPath),
      });
      repository.close();
    },
  );
});
