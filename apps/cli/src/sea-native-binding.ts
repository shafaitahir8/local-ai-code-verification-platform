import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, resolve } from 'node:path';

import type { SqliteNativeBinding } from '@verify/storage';

export const SQLITE_NATIVE_ASSET_NAME = 'better_sqlite3.node';

function seaModule() {
  const sea = process.getBuiltinModule('node:sea');
  if (sea === undefined) throw new Error('This Node.js runtime does not provide node:sea.');
  return sea;
}

export interface NativeAssetCacheOptions {
  readonly cacheDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory?: string;
}

function defaultCacheDirectory(
  environment: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): string {
  const localAppData = environment.LOCALAPPDATA?.trim();
  return localAppData
    ? join(localAppData, 'Local Code Verifier', 'engine-cache')
    : join(homeDirectory, '.verify', 'engine-cache');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function fileMatches(path: string, expectedHash: string): boolean {
  try {
    return sha256(readFileSync(path)) === expectedHash;
  } catch {
    return false;
  }
}

function asBuffer(asset: ArrayBuffer | ArrayBufferView): Buffer {
  if (ArrayBuffer.isView(asset)) {
    return Buffer.from(asset.buffer, asset.byteOffset, asset.byteLength);
  }
  return Buffer.from(asset);
}

/**
 * Publishes an embedded native addon through a content-addressed, owner-writable cache.
 * A complete temporary file is hard-linked into place so readers never observe partial bytes.
 */
export function cacheEmbeddedNativeAsset(
  asset: ArrayBuffer | ArrayBufferView,
  options: NativeAssetCacheOptions = {},
): string {
  const bytes = asBuffer(asset);
  if (bytes.byteLength === 0) throw new Error('The embedded SQLite native addon is empty.');

  const digest = sha256(bytes);
  const cacheDirectory = resolve(
    options.cacheDirectory ??
      defaultCacheDirectory(options.environment ?? process.env, options.homeDirectory ?? homedir()),
  );
  mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
  chmodSync(cacheDirectory, 0o700);

  const destination = join(cacheDirectory, `better_sqlite3-${digest}.node`);
  if (fileMatches(destination, digest)) return destination;

  const temporary = join(
    cacheDirectory,
    `.better_sqlite3-${digest}-${process.pid}-${randomBytes(8).toString('hex')}.tmp`,
  );

  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    if (!fileMatches(temporary, digest)) {
      throw new Error('The extracted SQLite native addon failed its integrity check.');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (fileMatches(destination, digest)) return destination;
      if (existsSync(destination)) rmSync(destination, { force: true });

      try {
        linkSync(temporary, destination);
      } catch (error) {
        if (fileMatches(destination, digest)) return destination;
        if (attempt === 2) throw error;
        continue;
      }

      chmodSync(destination, 0o600);
      if (fileMatches(destination, digest)) return destination;
      rmSync(destination, { force: true });
    }

    throw new Error('Unable to publish the embedded SQLite native addon safely.');
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Loads a verified `.node` file without relying on CommonJS module resolution. */
export function loadSqliteNativeBinding(path: string): SqliteNativeBinding {
  const resolvedPath = resolve(path);
  if (extname(resolvedPath).toLowerCase() !== '.node') {
    throw new Error(`Refusing to load a non-.node SQLite binding: ${resolvedPath}`);
  }

  const nativeModule = { exports: {} } as NodeModule;
  process.dlopen(nativeModule, resolvedPath);
  const binding: unknown = nativeModule.exports;
  if (typeof binding !== 'object' || binding === null) {
    throw new Error('The SQLite native addon did not export an object.');
  }
  return binding;
}

/** Extracts, verifies, and loads the SQLite addon embedded in the running Node SEA. */
export function loadEmbeddedSqliteNativeBinding(
  options: NativeAssetCacheOptions = {},
): SqliteNativeBinding {
  const sea = seaModule();
  if (!sea.isSea()) throw new Error('The embedded SQLite binding is available only in a Node SEA.');
  const path = cacheEmbeddedNativeAsset(sea.getAsset(SQLITE_NATIVE_ASSET_NAME), options);
  if (!existsSync(path)) throw new Error('The SQLite native addon extraction did not complete.');
  return loadSqliteNativeBinding(path);
}
