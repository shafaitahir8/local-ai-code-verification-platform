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
  return execFileSync(gitExe, args, {
    cwd: repository,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
  });
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

const commandTrap = 'cmd.exe /d /s /c "echo unexpected>PROFILE_COMMAND_EXECUTED"';

function writeFixtureFile(repository, path, content) {
  const destination = join(repository, ...path.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function writePackageManifest(repository, path, manifest) {
  writeFixtureFile(repository, path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function createProfileRepository(definition) {
  const repository = join(smokeRoot, `repository profile ${definition.name}`);
  definition.write(repository);
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
    `profile fixture ${definition.name}`,
  );
  return {
    ...definition,
    repository,
    commandMarkers: definition.commandMarkerPaths.map((path) =>
      join(repository, ...path.split('/')),
    ),
  };
}

const profileDefinitions = [
  {
    name: 'vite-vitest',
    expectedCapabilities: [
      'runtime.node',
      'package-manager.pnpm',
      'framework.vite',
      'test-framework.vitest',
    ],
    forbiddenCapabilities: ['preview.static-html'],
    expectedWorkspacePaths: ['.'],
    expectedAmbiguities: [],
    commandMarkerPaths: ['PROFILE_COMMAND_EXECUTED'],
    write(repository) {
      writePackageManifest(repository, 'package.json', {
        name: 'smoke-vite-vitest',
        private: true,
        packageManager: 'pnpm@11.22.0',
        scripts: { build: commandTrap, test: commandTrap },
        devDependencies: { vite: '7.1.7', vitest: '5.0.0' },
      });
      writeFixtureFile(repository, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
      writeFixtureFile(repository, 'index.html', '<main id="app"></main>\n');
      writeFixtureFile(repository, 'vite.config.ts', 'export default {};\n');
      writeFixtureFile(repository, 'vitest.config.ts', 'export default {};\n');
      writeFixtureFile(repository, 'tests/profile.test.ts', 'throw new Error("not run");\n');
    },
  },
  {
    name: 'jest',
    expectedCapabilities: ['runtime.node', 'package-manager.npm', 'test-framework.jest'],
    forbiddenCapabilities: ['preview.static-html', 'test-framework.vitest'],
    expectedWorkspacePaths: ['.'],
    expectedAmbiguities: [],
    commandMarkerPaths: ['PROFILE_COMMAND_EXECUTED'],
    write(repository) {
      writePackageManifest(repository, 'package.json', {
        name: 'smoke-jest',
        private: true,
        packageManager: 'npm@11.6.0',
        scripts: { test: commandTrap },
        devDependencies: { jest: '30.1.3' },
      });
      writeFixtureFile(repository, 'package-lock.json', '{}\n');
      writeFixtureFile(repository, 'jest.config.js', 'export default {};\n');
      writeFixtureFile(repository, 'tests/profile.test.js', 'throw new Error("not run");\n');
    },
  },
  {
    name: 'plain-static',
    expectedCapabilities: ['preview.static-html'],
    forbiddenCapabilities: ['framework.vite', 'runtime.node'],
    expectedWorkspacePaths: [],
    expectedAmbiguities: [],
    commandMarkerPaths: [],
    write(repository) {
      writeFixtureFile(repository, 'index.html', '<h1>Plain static smoke</h1>\n');
    },
  },
  {
    name: 'python-pytest',
    expectedCapabilities: ['language.python', 'runtime.python', 'test-framework.pytest'],
    forbiddenCapabilities: ['runtime.node', 'test-framework.vitest'],
    expectedWorkspacePaths: ['.'],
    expectedAmbiguities: [],
    commandMarkerPaths: [],
    write(repository) {
      writeFixtureFile(
        repository,
        'pyproject.toml',
        ['[project]', 'name = "smoke-python"', 'dependencies = ["pytest>=8"]', ''].join('\n'),
      );
      writeFixtureFile(repository, 'pytest.ini', '[pytest]\ntestpaths = tests\n');
      writeFixtureFile(repository, 'tests/test_profile.py', 'raise RuntimeError("not run")\n');
    },
  },
  {
    name: 'npm-workspace',
    expectedCapabilities: ['runtime.node', 'package-manager.npm', 'workspace-system.npm'],
    forbiddenCapabilities: [],
    expectedWorkspacePaths: ['.', 'packages/web'],
    expectedAmbiguities: [],
    commandMarkerPaths: ['packages/web/PROFILE_COMMAND_EXECUTED'],
    write(repository) {
      writePackageManifest(repository, 'package.json', {
        name: 'smoke-npm-workspace',
        private: true,
        packageManager: 'npm@11.6.0',
        workspaces: ['packages/*'],
      });
      writeFixtureFile(repository, 'package-lock.json', '{}\n');
      writePackageManifest(repository, 'packages/web/package.json', {
        name: '@smoke/npm-web',
        private: true,
        scripts: { start: commandTrap, test: commandTrap },
      });
    },
  },
  {
    name: 'pnpm-workspace',
    expectedCapabilities: ['runtime.node', 'package-manager.pnpm', 'workspace-system.pnpm'],
    forbiddenCapabilities: [],
    expectedWorkspacePaths: ['.', 'packages/core'],
    expectedAmbiguities: [],
    commandMarkerPaths: ['packages/core/PROFILE_COMMAND_EXECUTED'],
    write(repository) {
      writePackageManifest(repository, 'package.json', {
        name: 'smoke-pnpm-workspace',
        private: true,
        packageManager: 'pnpm@11.22.0',
      });
      writeFixtureFile(repository, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
      writeFixtureFile(
        repository,
        'pnpm-workspace.yaml',
        ['packages:', "  - 'packages/*'", ''].join('\n'),
      );
      writePackageManifest(repository, 'packages/core/package.json', {
        name: '@smoke/pnpm-core',
        private: true,
        scripts: { test: commandTrap },
      });
    },
  },
  {
    name: 'yarn-workspace',
    expectedCapabilities: ['runtime.node', 'package-manager.yarn', 'workspace-system.yarn'],
    forbiddenCapabilities: [],
    expectedWorkspacePaths: ['.', 'apps/site'],
    expectedAmbiguities: [],
    commandMarkerPaths: ['apps/site/PROFILE_COMMAND_EXECUTED'],
    write(repository) {
      writePackageManifest(repository, 'package.json', {
        name: 'smoke-yarn-workspace',
        private: true,
        packageManager: 'yarn@4.9.2',
        workspaces: { packages: ['apps/*'] },
      });
      writeFixtureFile(repository, 'yarn.lock', '# smoke lock\n');
      writePackageManifest(repository, 'apps/site/package.json', {
        name: '@smoke/yarn-site',
        private: true,
        scripts: { start: commandTrap },
      });
    },
  },
  {
    name: 'mixed-ambiguous',
    expectedCapabilities: [
      'runtime.node',
      'package-manager.pnpm',
      'framework.vite',
      'test-framework.vitest',
      'language.python',
      'runtime.python',
      'test-framework.pytest',
      'workspace-system.pnpm',
    ],
    forbiddenCapabilities: [],
    expectedWorkspacePaths: ['.', '.', 'packages/alpha', 'packages/beta'],
    expectedAmbiguities: [
      'MULTIPLE_WORKSPACE_TARGETS',
      'MULTIPLE_TEST_FRAMEWORKS',
      'MULTIPLE_TEST_TARGETS',
      'MULTIPLE_RUN_TARGETS',
    ],
    commandMarkerPaths: [
      'PROFILE_COMMAND_EXECUTED',
      'packages/alpha/PROFILE_COMMAND_EXECUTED',
      'packages/beta/PROFILE_COMMAND_EXECUTED',
    ],
    write(repository) {
      writePackageManifest(repository, 'package.json', {
        name: 'smoke-profile-mixed',
        private: true,
        packageManager: 'pnpm@11.22.0',
        scripts: { test: commandTrap, build: commandTrap },
        devDependencies: { vite: '7.1.7', vitest: '5.0.0' },
      });
      writeFixtureFile(repository, 'pnpm-lock.yaml', "lockfileVersion: '9.0'\n");
      writeFixtureFile(
        repository,
        'pnpm-workspace.yaml',
        ['packages:', "  - 'packages/*'", ''].join('\n'),
      );
      writeFixtureFile(
        repository,
        'pyproject.toml',
        ['[project]', 'name = "smoke-profile-python"', 'dependencies = ["pytest>=8"]', ''].join(
          '\n',
        ),
      );
      writeFixtureFile(repository, 'pytest.ini', '[pytest]\ntestpaths = tests\n');
      writeFixtureFile(repository, 'vite.config.ts', 'export default {};\n');
      writeFixtureFile(repository, 'vitest.config.ts', 'export default {};\n');
      writeFixtureFile(repository, 'tests/profile.test.ts', 'throw new Error("not run");\n');
      writeFixtureFile(repository, 'tests/test_profile.py', 'raise RuntimeError("not run")\n');
      for (const packageName of ['alpha', 'beta']) {
        writePackageManifest(repository, `packages/${packageName}/package.json`, {
          name: `@smoke/${packageName}`,
          private: true,
          scripts: { start: commandTrap, test: commandTrap },
        });
      }
    },
  },
];

function assertNoProfileSideEffects(fixture, phase) {
  for (const marker of fixture.commandMarkers) {
    if (existsSync(marker)) {
      throw new Error(
        `Project profiling executed an observed ${fixture.name} project command during ${phase}: ${marker}`,
      );
    }
  }
  if (existsSync(database) || existsSync(`${database}-wal`) || existsSync(`${database}-shm`)) {
    throw new Error(`Profile-only ${fixture.name} ${phase} initialized SQLite history storage.`);
  }
  const profileStatus = git(fixture.repository, 'status', '--short');
  if (profileStatus.length > 0) {
    throw new Error(
      `Project profiling changed the ${fixture.name} repository during ${phase}: ${profileStatus}`,
    );
  }
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

  const profileFixtures = profileDefinitions.map((definition) =>
    createProfileRepository(definition),
  );
  for (const fixture of profileFixtures) {
    const profile = JSON.parse(run(['understand', fixture.repository, '--json'], 0));
    if (profile.status !== 'completed' || profile.profile?.completeness !== 'complete') {
      throw new Error(
        `Self-contained engine did not return a complete ${fixture.name} project profile.`,
      );
    }
    for (const capability of fixture.expectedCapabilities) {
      if (!profile.profile.capabilities.some(({ id }) => id === capability)) {
        throw new Error(`Self-contained engine ${fixture.name} profile omitted ${capability}.`);
      }
    }
    for (const capability of fixture.forbiddenCapabilities) {
      if (profile.profile.capabilities.some(({ id }) => id === capability)) {
        throw new Error(
          `Self-contained engine ${fixture.name} profile incorrectly included ${capability}.`,
        );
      }
    }
    const workspacePaths = profile.profile.workspaceUnits.map(({ path }) => path).sort();
    const expectedWorkspacePaths = [...fixture.expectedWorkspacePaths].sort();
    if (JSON.stringify(workspacePaths) !== JSON.stringify(expectedWorkspacePaths)) {
      throw new Error(
        `Self-contained engine ${fixture.name} workspaces were ${JSON.stringify(workspacePaths)}; expected ${JSON.stringify(expectedWorkspacePaths)}.`,
      );
    }
    const ambiguityCodes = profile.profile.ambiguities.map(({ code }) => code).sort();
    const expectedAmbiguities = [...fixture.expectedAmbiguities].sort();
    if (JSON.stringify(ambiguityCodes) !== JSON.stringify(expectedAmbiguities)) {
      throw new Error(
        `Self-contained engine ${fixture.name} ambiguities were ${JSON.stringify(ambiguityCodes)}; expected ${JSON.stringify(expectedAmbiguities)}.`,
      );
    }
    if ('selectedWorkspaceId' in profile.profile || 'selectedTaskId' in profile.profile) {
      throw new Error(`Self-contained engine ${fixture.name} profile selected a default target.`);
    }
    assertNoProfileSideEffects(fixture, 'completion');
  }

  const profileFixture = profileFixtures.find(({ name }) => name === 'mixed-ambiguous');
  if (profileFixture === undefined) throw new Error('Mixed profile smoke fixture is unavailable.');

  const profileRequestId = 'outside-checkout-profile-cancel';
  const cancelRequestId = 'outside-checkout-profile-cancel-control';
  const profileCancellation = run(
    ['protocol'],
    0,
    [
      JSON.stringify({
        protocolVersion: 1,
        id: profileRequestId,
        method: 'project.profile',
        params: { repository: profileFixture.repository },
      }),
      JSON.stringify({
        protocolVersion: 1,
        id: cancelRequestId,
        method: 'operation.cancel',
        params: { targetRequestId: profileRequestId },
      }),
      '',
    ].join('\n'),
  )
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const cancelAcknowledgement = profileCancellation.find(
    (message) => message.id === cancelRequestId && 'result' in message,
  );
  const cancelledProfile = profileCancellation.filter(
    (message) => message.id === profileRequestId && 'result' in message,
  );
  if (cancelAcknowledgement?.result?.accepted !== true) {
    throw new Error('Self-contained engine did not accept correlated profile cancellation.');
  }
  if (cancelledProfile.length !== 1 || cancelledProfile[0]?.result?.status !== 'cancelled') {
    throw new Error('Self-contained engine did not return exactly one cancelled profile result.');
  }
  assertNoProfileSideEffects(profileFixture, 'cancellation');

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
    `Windows engine smoke passed for ${engine}: eight-profile matrix/cancellation, no profile writes or command execution, PASS/WARN/BLOCK, history, protocol argv, and no Node.js on PATH.\n`,
  );
} finally {
  rmSync(smokeRoot, { recursive: true, force: true });
}
