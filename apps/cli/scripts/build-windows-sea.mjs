import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const TARGET_TRIPLE = 'x86_64-pc-windows-msvc';
const SEA_RESOURCE_NAME = 'NODE_SEA_BLOB';
const SEA_SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const SQLITE_ASSET_NAME = 'better_sqlite3.node';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows SEA builder requires a Windows x64 Node.js runtime.');
}
if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error(`The Windows SEA builder requires Node.js 24.x; found ${process.version}.`);
}

const require = createRequire(import.meta.url);
const cliRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(cliRoot, '../..');
const bundle = join(cliRoot, 'dist', 'sea', 'sea-entry.cjs');
const workDirectory = join(cliRoot, 'dist', 'sea', 'build');
const configPath = join(workDirectory, 'sea-config.json');
const blobPath = join(workDirectory, 'sea-prep.blob');
const outputDirectory = join(repositoryRoot, 'apps', 'desktop', 'src-tauri', 'binaries');
const outputPath = join(outputDirectory, `verify-engine-${TARGET_TRIPLE}.exe`);
const portablePath = (path) => relative(cliRoot, path).replaceAll('\\', '/');

if (!existsSync(bundle)) {
  throw new Error(`The fully bundled SEA entry does not exist: ${bundle}`);
}

const betterSqliteEntry = require.resolve('better-sqlite3');
const betterSqliteRoot = resolve(dirname(betterSqliteEntry), '..');
const sqliteAddon = join(betterSqliteRoot, 'prebuilds', 'win32-x64.node');
if (!existsSync(sqliteAddon)) {
  throw new Error(`The better-sqlite3 Windows x64 addon does not exist: ${sqliteAddon}`);
}

const postjectRoot = dirname(require.resolve('postject/package.json'));
const postjectCli = join(postjectRoot, 'dist', 'cli.js');
if (!existsSync(postjectCli)) throw new Error(`The pinned postject CLI is missing: ${postjectCli}`);

rmSync(workDirectory, { recursive: true, force: true });
mkdirSync(workDirectory, { recursive: true });
mkdirSync(outputDirectory, { recursive: true });

writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      main: portablePath(bundle),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets: { [SQLITE_ASSET_NAME]: portablePath(sqliteAddon) },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

execFileSync(process.execPath, ['--experimental-sea-config', configPath], {
  cwd: cliRoot,
  stdio: 'inherit',
});
rmSync(outputPath, { force: true });
copyFileSync(process.execPath, outputPath);
execFileSync(
  process.execPath,
  [postjectCli, outputPath, SEA_RESOURCE_NAME, blobPath, '--sentinel-fuse', SEA_SENTINEL],
  { stdio: 'inherit' },
);

if (readFileSync(outputPath).includes(Buffer.from(repositoryRoot))) {
  throw new Error('The generated Windows engine contains the absolute development checkout path.');
}

execFileSync(outputPath, ['--version'], {
  env: { ...process.env, VERIFY_DATABASE_PATH: ':memory:' },
  stdio: 'inherit',
});

process.stdout.write(`Windows engine sidecar: ${outputPath}\n`);
