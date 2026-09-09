import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const target = 'x86_64-pc-windows-msvc';
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('The Windows engine smoke test requires Windows x64.');
}

const root = resolve(import.meta.dirname, '../../..');
const builtEngine = join(
  root,
  'apps',
  'desktop',
  'src-tauri',
  'binaries',
  `verify-engine-${target}.exe`,
);
const smokeRoot = mkdtempSync(join(tmpdir(), 'verify engine smoke \u00fc '));
const explicitEngine = process.env.VERIFY_ENGINE_PATH?.trim();
const installDir = explicitEngine
  ? dirname(resolve(explicitEngine))
  : join(smokeRoot, 'installed app');
const engine = explicitEngine ? resolve(explicitEngine) : join(installDir, 'verify-engine.exe');
const launchDir = join(smokeRoot, 'outside checkout launch');
const database = join(smokeRoot, 'user data', 'history.sqlite3');

function locate(name) {
  const found = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  const first = found.stdout?.split(/\r?\n/u).find((line) => line.trim());
  if (found.status !== 0 || first === undefined)
    throw new Error(`Required executable not found: ${name}`);
  return first.trim();
}

const gitExe = locate('git.exe');
const system32 = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
const environment = {
  ...process.env,
  PATH: `${system32};${dirname(gitExe)}`,
  LOCALAPPDATA: join(smokeRoot, 'user data'),
  VERIFY_DATABASE_PATH: database,
};

function git(repository, ...args) {
  execFileSync(gitExe, args, { cwd: repository, stdio: 'pipe', windowsHide: true });
}

function createRepository(name, exitCode, policy) {
  const repository = join(smokeRoot, `repository ${name}`);
  mkdirSync(join(repository, '.verify'), { recursive: true });
  writeFileSync(join(repository, 'README.md'), `# ${name}\n`);
  writeFileSync(
    join(repository, '.verify', 'project.yml'),
    [
      'version: 1',
      'project:',
      `  name: smoke-${name}`,
      'suites:',
      '  smoke:',
      '    type: test',
      `    command: 'cmd.exe /d /s /c "exit ${exitCode}"'`,
      `    failure_policy: ${policy}`,
      '',
    ].join('\n'),
  );
  git(repository, 'init', '--initial-branch=main', '--quiet');
  git(repository, 'add', '.');
  git(
    repository,
    '-c',
    'user.name=Verifier Smoke',
    '-c',
    'user.email=verifier@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'smoke fixture',
  );
  return repository;
}

function run(args, expectedCode, input) {
  const result = spawnSync(engine, args, {
    cwd: launchDir,
    env: environment,
    input,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== expectedCode || result.stderr !== '') {
    throw new Error(
      `Engine ${args.join(' ')} failed (${String(result.status)}).\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return result.stdout;
}

try {
  mkdirSync(installDir, { recursive: true });
  mkdirSync(launchDir, { recursive: true });
  if (explicitEngine === undefined) cpSync(builtEngine, engine);
  if (!existsSync(engine)) throw new Error(`Engine does not exist: ${engine}`);

  const node = spawnSync('where.exe', ['node.exe'], {
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (node.status === 0) throw new Error(`Node.js remains on the smoke PATH: ${node.stdout}`);

  const repositories = {
    PASS: createRepository('pass', 0, 'block'),
    WARN: createRepository('warn', 7, 'warn'),
    BLOCK: createRepository('block', 9, 'block'),
  };
  for (const [status, repository] of Object.entries(repositories)) {
    const result = JSON.parse(run(['run', repository, '--json'], status === 'BLOCK' ? 1 : 0));
    if (result.gate?.status !== status)
      throw new Error(`Expected ${status}; received ${result.gate?.status}.`);
  }

  const history = JSON.parse(run(['history', repositories.PASS, '--json'], 0));
  if (!Array.isArray(history) || history[0]?.gate?.status !== 'PASS') {
    throw new Error('Persisted PASS history was unavailable to a fresh engine process.');
  }

  const id = 'outside-checkout-protocol-smoke';
  const protocol = run(
    ['protocol'],
    0,
    `${JSON.stringify({
      protocolVersion: 1,
      id,
      method: 'repository.inspect',
      params: { repository: repositories.PASS },
    })}\n`,
  )
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  if (protocol.length !== 1 || protocol[0]?.id !== id || !('result' in protocol[0])) {
    throw new Error('Packaged protocol argv/framing smoke failed.');
  }

  process.stdout.write(
    `Windows engine smoke passed for ${engine}: PASS/WARN/BLOCK, history, protocol argv, and no Node.js on PATH.\n`,
  );
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
