import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const requiredEnvironment = [
  'VERIFY_INSTALLED_ENGINE_PATH',
  'VERIFY_SMOKE_DEBUG_PORT',
  'VERIFY_SMOKE_GIT_PATH',
  'VERIFY_SMOKE_ROOT',
];
for (const name of requiredEnvironment) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required environment variable ${name}.`);
}

const engine = resolve(process.env.VERIFY_INSTALLED_ENGINE_PATH);
const gitExecutable = resolve(process.env.VERIFY_SMOKE_GIT_PATH);
const powershellExecutable = join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const smokeRoot = resolve(process.env.VERIFY_SMOKE_ROOT);
const debugPort = Number(process.env.VERIFY_SMOKE_DEBUG_PORT);
const database = process.env.VERIFY_DATABASE_PATH;
const smokeMode = process.env.VERIFY_SMOKE_MODE?.trim() || 'primary';
if (!existsSync(engine)) throw new Error(`Installed engine does not exist: ${engine}`);
if (!existsSync(gitExecutable)) throw new Error(`Git executable does not exist: ${gitExecutable}`);
if (!database)
  throw new Error('VERIFY_DATABASE_PATH must point at the installed-workflow database.');
if (!['primary', 'restart'].includes(smokeMode)) {
  throw new Error(`Unsupported installed UI smoke mode: ${smokeMode}`);
}
if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65_535) {
  throw new Error(`Invalid WebView2 debug port: ${process.env.VERIFY_SMOKE_DEBUG_PORT}`);
}

mkdirSync(smokeRoot, { recursive: true });

function git(repository, ...args) {
  execFileSync(gitExecutable, args, {
    cwd: repository,
    stdio: 'pipe',
    windowsHide: true,
  });
}

function initializeRepository(repository) {
  git(repository, 'init', '--initial-branch=main', '--quiet');
  git(repository, 'add', '.');
  git(
    repository,
    '-c',
    'user.name=Installed Workflow Smoke',
    '-c',
    'user.email=verifier@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'installed workflow fixture',
  );
}

function createGateRepository(status, exitCode, failurePolicy) {
  const repository = join(smokeRoot, `${status} repository ü`);
  mkdirSync(join(repository, '.verify'), { recursive: true });
  writeFileSync(join(repository, 'README.md'), `# Installed ${status} smoke\n`);
  writeFileSync(
    join(repository, '.verify', 'project.yml'),
    [
      'version: 1',
      'project:',
      `  name: installed-ui-${status.toLowerCase()}`,
      'suites:',
      '  smoke:',
      '    type: test',
      `    command: 'cmd.exe /d /s /c "echo UI_${status}_READY & exit ${exitCode}"'`,
      `    failure_policy: ${failurePolicy}`,
      '',
    ].join('\n'),
  );
  initializeRepository(repository);
  return repository;
}

const observedCommandTrap =
  'cmd.exe /d /s /c "echo unexpected>profiling-command-executed.marker & exit 91"';

function serializedJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeFixtureFiles(repository, files) {
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(repository, ...relativePath.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
}

function createProfileRepository(name, files) {
  const repository = join(smokeRoot, `${name} profile repository ü`);
  writeFixtureFiles(repository, {
    '.verify/project.yml': [
      'version: 1',
      'project:',
      `  name: installed-profile-${name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`,
      'suites:',
      '  smoke:',
      '    type: test',
      `    command: '${observedCommandTrap.replaceAll("'", "''")}'`,
      '    failure_policy: block',
      '',
    ].join('\n'),
    'README.md': `# Installed ${name} profile smoke\n`,
    ...files,
  });
  initializeRepository(repository);
  return repository;
}

function workspacePackage(name) {
  return serializedJson({
    name: `@smoke/${name}`,
    private: true,
    scripts: {
      start: observedCommandTrap,
      test: observedCommandTrap,
    },
  });
}

function createProfileFixtures() {
  const fixtures = [
    {
      name: 'Node Vite Vitest',
      files: {
        'index.html': '<!doctype html>\n<div id="app"></div>\n',
        'package-lock.json': serializedJson({ lockfileVersion: 3 }),
        'package.json': serializedJson({
          private: true,
          packageManager: 'npm@11.6.0',
          scripts: {
            build: observedCommandTrap,
            dev: observedCommandTrap,
            test: observedCommandTrap,
          },
          devDependencies: { vite: '7.1.7', vitest: '5.0.0' },
        }),
        'tests/profile.test.ts': 'throw new Error("profiling must not execute tests");\n',
        'vite.config.ts': 'export default {};\n',
        'vitest.config.ts': 'export default {};\n',
      },
      capabilities: ['Node.js', 'Vite', 'Vitest'],
      absentCapabilities: ['Static HTML'],
      evidence: ['index.html', 'package.json', 'vite.config.ts', 'vitest.config.ts'],
      workspaceUnits: ['.'],
    },
    {
      name: 'Node Jest',
      files: {
        'jest.config.cjs': 'module.exports = {};\n',
        'package-lock.json': serializedJson({ lockfileVersion: 3 }),
        'package.json': serializedJson({
          private: true,
          packageManager: 'npm@11.6.0',
          scripts: { test: observedCommandTrap },
          devDependencies: { jest: '30.2.0' },
        }),
        'tests/profile.test.js': 'throw new Error("profiling must not execute tests");\n',
      },
      capabilities: ['Node.js', 'Jest'],
      evidence: ['jest.config.cjs', 'package.json', 'tests/profile.test.js'],
      workspaceUnits: ['.'],
    },
    {
      name: 'Plain static',
      files: {
        'index.html': '<!doctype html>\n<title>Plain static profile</title>\n',
      },
      capabilities: ['Static HTML'],
      absentCapabilities: ['Vite'],
      evidence: ['index.html'],
    },
    {
      name: 'Python pytest',
      files: {
        'pyproject.toml': ['[project]', 'dependencies = ["pytest>=8"]', ''].join('\n'),
        'pytest.ini': '[pytest]\ntestpaths = tests\n',
        'tests/test_profile.py': 'raise RuntimeError("profiling must not execute tests")\n',
      },
      capabilities: ['Python', 'pytest'],
      evidence: ['pyproject.toml', 'pytest.ini', 'tests/test_profile.py'],
    },
    {
      name: 'npm workspace',
      files: {
        'package-lock.json': serializedJson({ lockfileVersion: 3 }),
        'package.json': serializedJson({
          private: true,
          packageManager: 'npm@11.6.0',
          workspaces: ['packages/*'],
        }),
        'packages/alpha/package.json': workspacePackage('npm-alpha'),
        'packages/beta/package.json': workspacePackage('npm-beta'),
      },
      capabilities: ['Node.js', 'npm workspaces'],
      evidence: ['package.json'],
      workspaceUnits: [
        '.',
        '@smoke/npm-alpha',
        'packages/alpha',
        '@smoke/npm-beta',
        'packages/beta',
      ],
    },
    {
      name: 'pnpm workspace',
      files: {
        'package.json': serializedJson({ private: true, packageManager: 'pnpm@11.22.0' }),
        'packages/alpha/package.json': workspacePackage('pnpm-alpha'),
        'packages/beta/package.json': workspacePackage('pnpm-beta'),
        'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
        'pnpm-workspace.yaml': ['packages:', "  - 'packages/*'", ''].join('\n'),
      },
      capabilities: ['Node.js', 'pnpm workspaces'],
      evidence: ['package.json', 'pnpm-workspace.yaml'],
      workspaceUnits: [
        '.',
        '@smoke/pnpm-alpha',
        'packages/alpha',
        '@smoke/pnpm-beta',
        'packages/beta',
      ],
    },
    {
      name: 'Yarn workspace',
      files: {
        'apps/alpha/package.json': workspacePackage('yarn-alpha'),
        'apps/beta/package.json': workspacePackage('yarn-beta'),
        'package.json': serializedJson({
          private: true,
          packageManager: 'yarn@4.9.2',
          workspaces: { packages: ['apps/*'] },
        }),
        'yarn.lock': '# installed smoke lockfile\n',
      },
      capabilities: ['Node.js', 'yarn workspaces'],
      evidence: ['package.json'],
      workspaceUnits: ['.', '@smoke/yarn-alpha', 'apps/alpha', '@smoke/yarn-beta', 'apps/beta'],
    },
    {
      name: 'Mixed Node Python',
      files: {
        'package.json': serializedJson({
          private: true,
          packageManager: 'pnpm@11.22.0',
          scripts: { test: observedCommandTrap },
          devDependencies: { vitest: '5.0.0' },
        }),
        'packages/alpha/package.json': workspacePackage('mixed-alpha'),
        'packages/beta/package.json': workspacePackage('mixed-beta'),
        'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
        'pnpm-workspace.yaml': ['packages:', "  - 'packages/*'", ''].join('\n'),
        'pyproject.toml': ['[project]', 'dependencies = ["pytest>=8"]', ''].join('\n'),
        'pytest.ini': '[pytest]\ntestpaths = tests\n',
        'tests/profile.test.ts': 'throw new Error("profiling must not execute tests");\n',
        'tests/test_profile.py': 'raise RuntimeError("profiling must not execute tests")\n',
        'vitest.config.ts': 'export default {};\n',
      },
      capabilities: ['Node.js', 'Python', 'pytest', 'pnpm workspaces', 'Vitest'],
      evidence: ['package.json', 'pnpm-workspace.yaml', 'pyproject.toml', 'pytest.ini'],
      workspaceUnits: [
        '@smoke/mixed-alpha',
        'packages/alpha',
        '@smoke/mixed-beta',
        'packages/beta',
      ],
      ambiguities: [
        'Multiple declared workspace package roots remain credible; none is selected.',
        'Multiple evidence-backed test frameworks are present; no default framework was selected.',
        'Multiple evidence-backed test commands are present; no default test target was selected.',
        'Multiple evidence-backed run or preview commands are present; no default launch target was selected.',
      ],
      cancelRefresh: true,
    },
  ];

  return fixtures.map((fixture) => ({
    ...fixture,
    repository: createProfileRepository(fixture.name, fixture.files),
  }));
}

function createCancellationRepository() {
  const repository = join(smokeRoot, 'Cancellation repository ü');
  const verifyDirectory = join(repository, '.verify');
  mkdirSync(verifyDirectory, { recursive: true });
  writeFileSync(join(repository, 'README.md'), '# Installed cancellation smoke\n');
  writeFileSync(
    join(verifyDirectory, 'slow-check.ps1'),
    [
      "$ErrorActionPreference = 'Stop'",
      "Set-Content -LiteralPath '.verify\\command-parent.pid' -Value $PID -Encoding ascii",
      "$child = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\ping.exe') -ArgumentList @('127.0.0.1', '-n', '120') -WindowStyle Hidden -PassThru",
      "Set-Content -LiteralPath '.verify\\command-child.pid' -Value $child.Id -Encoding ascii",
      'Write-Output "TREE_READY parent=$PID child=$($child.Id)"',
      '$child.WaitForExit()',
      'exit $child.ExitCode',
      '',
    ].join('\r\n'),
  );
  writeFileSync(
    join(verifyDirectory, 'project.yml'),
    [
      'version: 1',
      'project:',
      '  name: installed-ui-cancel',
      'suites:',
      '  slow:',
      '    type: test',
      `    command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".verify/slow-check.ps1"'`,
      '    failure_policy: block',
      '',
    ].join('\n'),
  );
  initializeRepository(repository);
  return repository;
}

class CdpClient {
  #nextId = 1;
  #pending = new Map();
  #socket;

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out connecting to WebView2.')),
        10_000,
      );
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolvePromise();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          reject(new Error('Could not connect to the WebView2 DevTools endpoint.'));
        },
        { once: true },
      );
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error)
        pending.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('WebView2 DevTools connection closed unexpectedly.'));
      }
      this.#pending.clear();
    });
  }

  send(method, params = {}, timeoutMs = 10_000) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Timed out waiting for CDP method ${method}.`));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolvePromise, reject, timeout });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
  }
}

async function delay(milliseconds) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function discoverPage() {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
        );
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`WebView2 DevTools page was unavailable.${lastError ? ` ${lastError}` : ''}`);
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'WebView expression failed.',
    );
  }
  return response.result?.value;
}

async function waitFor(client, expression, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return;
    await delay(150);
  }
  const body = await evaluate(
    client,
    'document.body?.innerText ?? document.body?.textContent ?? ""',
  );
  throw new Error(`Timed out waiting for ${description}. Current UI text:\n${body}`);
}

async function setRepository(client, repository) {
  const value = JSON.stringify(repository);
  await waitFor(
    client,
    'document.querySelector(\'input[aria-describedby="repository-path-help"]\') instanceof HTMLInputElement',
    'the installed repository form to render',
  );
  const updated = await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[aria-describedby="repository-path-help"]');
      if (!(input instanceof HTMLInputElement)) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, ${value});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.value === ${value};
    })()`,
  );
  if (!updated) throw new Error('Could not set the repository path in the installed UI.');
  await waitFor(
    client,
    `(() => {
      const input = document.querySelector('input[aria-describedby="repository-path-help"]');
      const submit = document.querySelector('form[aria-label="Open repository"] button[type="submit"]');
      return input?.value === ${value} && Boolean(submit && !submit.disabled);
    })()`,
    'the controlled repository input to settle',
    5_000,
  );
}

async function clickButton(client, label) {
  const expected = JSON.stringify(label);
  const clicked = await evaluate(
    client,
    `(() => {
      const normalize = (value) => value.replace(/\\s+/gu, ' ').trim();
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => normalize(candidate.textContent ?? '').includes(${expected}) && !candidate.disabled,
      );
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  if (!clicked) throw new Error(`Could not click enabled installed-UI button ${label}.`);
}

function repositoryReadyExpression(repository) {
  const path = JSON.stringify(repository);
  return `(() => {
    const input = document.querySelector('input[aria-describedby="repository-path-help"]');
    const run = [...document.querySelectorAll('button')].find(
      (button) => (button.textContent ?? '').includes('Run verification') && !button.disabled,
    );
    return input?.value === ${path} && Boolean(run);
  })()`;
}

function projectProfileReadyExpression(fixture, status = 'Profile ready') {
  const expectedStatus = JSON.stringify(status);
  const capabilities = JSON.stringify(fixture.capabilities ?? []);
  const absentCapabilities = JSON.stringify(fixture.absentCapabilities ?? []);
  const evidence = JSON.stringify(fixture.evidence ?? []);
  const workspaceUnits = JSON.stringify(fixture.workspaceUnits ?? []);
  const ambiguities = JSON.stringify(fixture.ambiguities ?? []);
  return `(() => {
    const body = document.body.textContent ?? '';
    const capabilityText = document.querySelector('[aria-label="Detected project capabilities"]')?.textContent ?? '';
    const evidenceText = document.querySelector('.profile-evidence')?.textContent ?? '';
    const workspaceText = document.querySelector('[aria-label="Detected workspace units"]')?.textContent ?? '';
    const ambiguityText = document.querySelector('#profile-ambiguities')?.parentElement?.textContent ?? '';
    return body.includes(${expectedStatus}) &&
      ${capabilities}.every((value) => capabilityText.includes(value)) &&
      ${absentCapabilities}.every((value) => !capabilityText.includes(value)) &&
      ${evidence}.every((value) => evidenceText.includes(value)) &&
      ${workspaceUnits}.every((value) => workspaceText.includes(value)) &&
      ${ambiguities}.every((value) => ambiguityText.includes(value));
  })()`;
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function repositoryFingerprint(repository, relativePath = '') {
  const fingerprints = {};
  const directory = join(repository, ...relativePath.split('/').filter(Boolean));
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, 'en'),
  )) {
    if (relativePath === '' && entry.name === '.git') continue;
    const path = relativePath === '' ? entry.name : `${relativePath}/${entry.name}`;
    const absolutePath = join(repository, ...path.split('/'));
    if (entry.isDirectory()) {
      Object.assign(fingerprints, repositoryFingerprint(repository, path));
    } else if (entry.isFile()) {
      fingerprints[path] = `file:${hashFile(absolutePath)}`;
    } else if (entry.isSymbolicLink()) {
      fingerprints[path] = `symlink:${readlinkSync(absolutePath)}`;
    }
  }
  return fingerprints;
}

function databaseFingerprint() {
  return Object.fromEntries(
    ['', '-wal', '-shm']
      .map((suffix) => `${database}${suffix}`)
      .filter(existsSync)
      .map((path) => [basename(path), hashFile(path)]),
  );
}

function cleanRepositoryStatus(repository) {
  return execFileSync(gitExecutable, ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
}

async function refreshProjectProfile(client) {
  const armed = await evaluate(
    client,
    `(() => {
      const card = document.querySelector('#project-overview-title')?.closest('[aria-busy]');
      const button = [...document.querySelectorAll('button')].find(
        (candidate) => (candidate.textContent ?? '').includes('Understand Project') && !candidate.disabled,
      );
      if (!card || !button) return false;
      const state = { sawRunning: false, completed: false };
      window.__VERIFY_SMOKE_PROFILE_REFRESH__ = state;
      const update = () => {
        if (card.getAttribute('aria-busy') === 'true') state.sawRunning = true;
        if (
          state.sawRunning &&
          card.getAttribute('aria-busy') === 'false' &&
          (card.textContent ?? '').includes('Profile ready')
        ) {
          state.completed = true;
          observer.disconnect();
        }
      };
      const observer = new MutationObserver(update);
      observer.observe(card, { attributes: true, childList: true, subtree: true });
      button.click();
      queueMicrotask(update);
      return true;
    })()`,
  );
  if (!armed) throw new Error('Could not start Understand Project in the installed UI.');
  await waitFor(
    client,
    'window.__VERIFY_SMOKE_PROFILE_REFRESH__?.completed === true',
    'Understand Project to run a complete profile refresh cycle',
  );
}

async function cancelProjectProfile(client, fixture) {
  const armed = await evaluate(
    client,
    `(() => {
      const refresh = [...document.querySelectorAll('button')].find(
        (candidate) => (candidate.textContent ?? '').includes('Understand Project') && !candidate.disabled,
      );
      if (!refresh) return false;
      const state = { stopClicked: false };
      window.__VERIFY_SMOKE_PROFILE_CANCELLATION__ = state;
      const clickStop = () => {
        const stop = [...document.querySelectorAll('button')].find(
          (candidate) => (candidate.textContent ?? '').includes('Stop project scan') && !candidate.disabled,
        );
        if (!stop) return;
        state.stopClicked = true;
        observer.disconnect();
        stop.click();
      };
      const observer = new MutationObserver(clickStop);
      observer.observe(document.body, { attributes: true, childList: true, subtree: true });
      refresh.click();
      queueMicrotask(clickStop);
      return true;
    })()`,
  );
  if (!armed) throw new Error('Could not arm installed-UI project profile cancellation.');
  await waitFor(
    client,
    'window.__VERIFY_SMOKE_PROFILE_CANCELLATION__?.stopClicked === true',
    'the installed UI Stop project scan control',
  );
  await waitFor(
    client,
    'document.body.textContent.includes("Refresh cancelled; the last completed profile remains displayed.")',
    'confirmed project profile cancellation in the installed UI',
  );
  await waitFor(
    client,
    projectProfileReadyExpression(fixture, 'Scan stopped'),
    'the last completed profile to remain after cancellation',
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (findInstalledEngineProcessIds().length === 0) return;
    await delay(200);
  }
  throw new Error('The project-profile sidecar remained alive after UI cancellation.');
}

async function validateProfileFixture(client, fixture, firstRepository) {
  await setRepository(client, fixture.repository);
  await clickButton(client, firstRepository ? 'Open project' : 'Inspect again');
  await waitFor(
    client,
    repositoryReadyExpression(fixture.repository),
    `the ${fixture.name} profile repository to load`,
  );
  await waitFor(
    client,
    projectProfileReadyExpression(fixture),
    `the ${fixture.name} deterministic profile and evidence to render`,
  );

  const beforeRepository = repositoryFingerprint(fixture.repository);
  const beforeDatabase = databaseFingerprint();
  const beforeStatus = cleanRepositoryStatus(fixture.repository);
  if (beforeStatus !== '') {
    throw new Error(`${fixture.name} was dirty before profile refresh:\n${beforeStatus}`);
  }

  await refreshProjectProfile(client);
  await waitFor(
    client,
    projectProfileReadyExpression(fixture),
    `the refreshed ${fixture.name} profile to remain stable`,
  );
  await delay(250);

  const afterStatus = cleanRepositoryStatus(fixture.repository);
  const afterRepository = repositoryFingerprint(fixture.repository);
  const afterDatabase = databaseFingerprint();
  if (afterStatus !== '') {
    throw new Error(`${fixture.name} profile refresh changed repository state:\n${afterStatus}`);
  }
  if (JSON.stringify(afterRepository) !== JSON.stringify(beforeRepository)) {
    throw new Error(`${fixture.name} profile refresh changed repository contents.`);
  }
  if (JSON.stringify(afterDatabase) !== JSON.stringify(beforeDatabase)) {
    throw new Error(`${fixture.name} profile refresh changed installed runtime database contents.`);
  }
  if (fixture.cancelRefresh) {
    await cancelProjectProfile(client, fixture);
    await delay(250);
    if (cleanRepositoryStatus(fixture.repository) !== '') {
      throw new Error(`${fixture.name} cancellation changed repository state.`);
    }
    if (
      JSON.stringify(repositoryFingerprint(fixture.repository)) !== JSON.stringify(afterRepository)
    ) {
      throw new Error(`${fixture.name} cancellation changed repository contents.`);
    }
    if (JSON.stringify(databaseFingerprint()) !== JSON.stringify(afterDatabase)) {
      throw new Error(`${fixture.name} cancellation changed installed runtime database contents.`);
    }
  }
  return {
    name: fixture.name,
    repository: fixture.repository,
    capabilities: fixture.capabilities,
    workspaceUnits: fixture.workspaceUnits ?? [],
    ambiguities: fixture.ambiguities ?? [],
    understandProjectRefresh: 'passed',
    profileCancellation: fixture.cancelRefresh ? 'passed' : 'not requested',
    repositoryWrites: 'none',
    databaseWrites: 'none',
    observedCommandExecution: false,
  };
}

function readPid(path) {
  const value = Number(readFileSync(path, 'utf8').trim());
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid process ID in ${path}.`);
  return value;
}

function findInstalledEngineProcessIds() {
  const result = spawnSync(
    powershellExecutable,
    [
      '-NoProfile',
      '-Command',
      '@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq $env:VERIFY_SMOKE_EXPECTED_ENGINE_NAME -and $_.ExecutablePath -eq $env:VERIFY_SMOKE_EXPECTED_ENGINE_PATH }).ProcessId',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        VERIFY_SMOKE_EXPECTED_ENGINE_NAME: basename(engine),
        VERIFY_SMOKE_EXPECTED_ENGINE_PATH: engine,
      },
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not inspect the installed sidecar process: ${result.stderr}`);
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessesToExit(processIds) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (processIds.every((pid) => !isProcessAlive(pid))) return;
    await delay(200);
  }
  const remaining = processIds.filter(isProcessAlive);
  throw new Error(
    `Verification descendants remained alive after cancellation: ${remaining.join(', ')}`,
  );
}

function readPersistedCancellation(repository) {
  const result = spawnSync(engine, ['history', repository, '--json'], {
    cwd: smokeRoot,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 || result.stderr !== '') {
    throw new Error(
      `Installed engine history failed (${String(result.status)}).\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  const runs = JSON.parse(result.stdout);
  const cancelled = runs.find((run) => run.status === 'cancelled');
  if (cancelled?.gate?.status !== 'BLOCK' || cancelled.checks?.[0]?.status !== 'cancelled') {
    throw new Error('Installed UI cancellation was not persisted as a cancelled BLOCK run.');
  }
  return cancelled;
}

const gateRepositories =
  smokeMode === 'primary'
    ? {
        PASS: createGateRepository('PASS', 0, 'block'),
        WARN: createGateRepository('WARN', 7, 'warn'),
        BLOCK: createGateRepository('BLOCK', 9, 'block'),
      }
    : undefined;
const profileFixtures = smokeMode === 'primary' ? createProfileFixtures() : undefined;
const cancellationRepository = smokeMode === 'primary' ? createCancellationRepository() : undefined;
let client;

try {
  const page = await discoverPage();
  client = await CdpClient.connect(page.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await waitFor(client, 'document.readyState === "complete"', 'installed UI document readiness');
  await waitFor(
    client,
    'Boolean(window.__TAURI_INTERNALS__)',
    'the native Tauri IPC runtime (not the browser mock)',
  );

  if (smokeMode === 'restart') {
    const restartRepositoryValue = process.env.VERIFY_SMOKE_RESTART_REPOSITORY?.trim();
    if (!restartRepositoryValue) {
      throw new Error('VERIFY_SMOKE_RESTART_REPOSITORY is required in restart mode.');
    }
    const restartRepository = resolve(restartRepositoryValue);
    await setRepository(client, restartRepository);
    await clickButton(client, 'Open project');
    await waitFor(
      client,
      repositoryReadyExpression(restartRepository),
      'the persisted PASS repository to reload after app restart',
    );
    await waitFor(
      client,
      '[...document.querySelectorAll("button[aria-label^=\\"Open run\\"]")].some((button) => button.getAttribute("aria-label")?.includes(", PASS"))',
      'persisted PASS history after app restart',
    );
    const openedHistory = await evaluate(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button[aria-label^="Open run"]')].find(
          (candidate) => candidate.getAttribute('aria-label')?.includes(', PASS'),
        );
        if (!button) return false;
        button.click();
        return true;
      })()`,
    );
    if (!openedHistory) throw new Error('Could not open persisted PASS history after app restart.');
    await waitFor(
      client,
      'document.body.textContent.includes("Saved verification run") && document.body.textContent.includes("Quality gate: PASS") && document.body.textContent.includes("UI_PASS_READY")',
      'persisted PASS evidence to render after app restart',
    );
    writeFileSync(
      join(smokeRoot, 'restart-summary.json'),
      `${JSON.stringify(
        {
          repository: restartRepository,
          historyAfterAppRestart: 'persisted and rendered',
          renderedGate: 'PASS',
          webviewTarget: page.url,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write('Installed UI restart smoke passed: persisted PASS history rendered.\n');
  } else {
    let firstRepository = true;
    const profileResults = [];
    for (const fixture of profileFixtures) {
      profileResults.push(await validateProfileFixture(client, fixture, firstRepository));
      firstRepository = false;
    }

    for (const [status, repository] of Object.entries(gateRepositories)) {
      await setRepository(client, repository);
      await clickButton(client, firstRepository ? 'Open project' : 'Inspect again');
      firstRepository = false;
      await waitFor(
        client,
        repositoryReadyExpression(repository),
        `the ${status} repository to load`,
      );
      await clickButton(client, 'Run verification');
      await waitFor(
        client,
        `document.body.textContent.includes("Quality gate: ${status}") && document.body.textContent.includes("UI_${status}_READY")`,
        `the installed UI ${status} result`,
      );
      await waitFor(
        client,
        `[...document.querySelectorAll("button[aria-label^=\\"Open run\\"]")].some((button) => button.getAttribute("aria-label")?.includes("${status}"))`,
        `persisted ${status} history in the installed UI`,
      );
    }

    await setRepository(client, cancellationRepository);
    await clickButton(client, 'Inspect again');
    await waitFor(
      client,
      repositoryReadyExpression(cancellationRepository),
      'the cancellation repository to load',
    );
    await clickButton(client, 'Run verification');
    await waitFor(
      client,
      'document.body.textContent.includes("TREE_READY") && document.body.textContent.includes("Stop run")',
      'the cancellable process tree to start',
    );

    const parentPidPath = join(cancellationRepository, '.verify', 'command-parent.pid');
    const childPidPath = join(cancellationRepository, '.verify', 'command-child.pid');
    if (!existsSync(parentPidPath) || !existsSync(childPidPath)) {
      throw new Error('The cancellable fixture did not record its process IDs.');
    }
    const commandProcessIds = [readPid(parentPidPath), readPid(childPidPath)];
    const engineProcessIds = findInstalledEngineProcessIds();
    if (engineProcessIds.length !== 1) {
      throw new Error(
        `Expected one installed verification sidecar during cancellation; found ${engineProcessIds.join(', ') || 'none'}.`,
      );
    }
    const processIds = [...commandProcessIds, ...engineProcessIds];
    if (!processIds.every(isProcessAlive)) {
      throw new Error(
        `The cancellable fixture exited before cancellation: ${processIds.join(', ')}`,
      );
    }

    await clickButton(client, 'Stop run');
    await waitFor(
      client,
      'document.body.textContent.includes("Verification interrupted and saved.") && document.body.textContent.includes("Quality gate: BLOCK") && document.body.textContent.includes("Run verification")',
      'persisted cancellation in the installed UI',
      30_000,
    );

    const cancelledRun = readPersistedCancellation(cancellationRepository);
    await waitForProcessesToExit(processIds);

    const summary = {
      gateRepositories,
      cancellationRepository,
      projectProfiles: profileResults,
      profileInterfaces: 'installed WebView -> Tauri IPC -> Rust bridge -> bundled sidecar',
      profileRefresh: 'Understand Project passed for every fixture',
      profileRepositoryWrites: 'none across before/after content and Git fingerprints',
      profileDatabaseWrites: 'none across before/after runtime-database fingerprints',
      profileObservedCommandExecution: false,
      renderedGates: ['PASS', 'WARN', 'BLOCK'],
      gateHistory: 'persisted and rendered',
      cancelledRunId: cancelledRun.id,
      cancellationStatus: cancelledRun.status,
      cancellationGate: cancelledRun.gate.status,
      recordedCommandProcessIds: commandProcessIds,
      recordedEngineProcessIds: engineProcessIds,
      orphanedRecordedProcesses: [],
      webviewTarget: page.url,
    };
    writeFileSync(join(smokeRoot, 'ui-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(
      'Installed UI workflow smoke passed: profile matrix and refresh, native PASS/WARN/BLOCK, persisted cancellation, and no recorded child processes remain.\n',
    );
  }
} catch (error) {
  if (client) {
    try {
      const body = await evaluate(
        client,
        '({ text: document.body?.innerText ?? "", html: document.documentElement?.outerHTML ?? "" })',
      );
      writeFileSync(join(smokeRoot, 'ui-failure-dom.json'), `${JSON.stringify(body, null, 2)}\n`);
      const capture = await client.send('Page.captureScreenshot', { format: 'png' });
      if (capture?.data) {
        writeFileSync(join(smokeRoot, 'ui-failure.png'), Buffer.from(capture.data, 'base64'));
      }
    } catch {
      // Preserve the original smoke failure when diagnostic capture is unavailable.
    }
  }
  throw error;
} finally {
  client?.close();
}
