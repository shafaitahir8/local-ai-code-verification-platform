import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  ProjectProfileResult,
  VerificationPlanPreviewResult,
  VerificationRun,
} from '@verify/domain';
import {
  decodeResultLine,
  decodeServerMessageLine,
  encodeRequest,
  projectProfileResultSchema,
  PROTOCOL_VERSION,
  type ProtocolRequest,
  type ProtocolResultMap,
  type ProtocolServerMessage,
} from '@verify/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { createApplicationComposition, type ApplicationComposition } from '../src/composition.js';
import { executeCli, type CliIo } from '../src/program.js';
import { handleProtocolRequest } from '../src/protocol-server.js';

const fixturesRoot = resolve(import.meta.dirname, '../../../fixtures');
const builtCliEntry = resolve(import.meta.dirname, '../dist/index.js');
const temporaryDirectories: string[] = [];
const openCompositions: ApplicationComposition[] = [];
const openProtocolProcesses = new Set<ChildProcessWithoutNullStreams>();

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface CliProcessOptions {
  readonly entry?: string;
  readonly stdin?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

interface ProtocolRecord {
  readonly line: string;
  readonly message: ProtocolServerMessage;
}

interface ProtocolRecordWaiter {
  readonly predicate: (record: ProtocolRecord) => boolean;
  readonly resolve: (record: ProtocolRecord) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface InteractiveProtocolProcess {
  readonly records: ProtocolRecord[];
  send(request: ProtocolRequest): void;
  waitFor(
    predicate: (record: ProtocolRecord) => boolean,
    description: string,
  ): Promise<ProtocolRecord>;
  finish(): Promise<CliResult>;
}

async function runCliProcess(
  args: readonly string[],
  database: string,
  options: CliProcessOptions = {},
): Promise<CliResult> {
  return new Promise<CliResult>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [options.entry ?? builtCliEntry, ...args], {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: {
        ...process.env,
        VERIFY_DATABASE_PATH: database,
        ...options.environment,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(options.stdin);
  });
}

function startProtocolProcess(
  database: string,
  environment: Readonly<Record<string, string>> = {},
): InteractiveProtocolProcess {
  const child = spawn(process.execPath, [builtCliEntry, 'protocol'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    env: { ...process.env, VERIFY_DATABASE_PATH: database, ...environment },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  openProtocolProcesses.add(child);

  const records: ProtocolRecord[] = [];
  const waiters = new Set<ProtocolRecordWaiter>();
  let stdout = '';
  let stderr = '';
  let pending = '';
  let decodeFailure: Error | undefined;

  const rejectWaiters = (error: Error): void => {
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    waiters.clear();
  };

  const acceptLine = (rawLine: string): void => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.trim().length === 0) return;

    let message: ProtocolServerMessage;
    try {
      message = decodeServerMessageLine(line);
    } catch (error) {
      decodeFailure = error instanceof Error ? error : new Error(String(error));
      rejectWaiters(decodeFailure);
      return;
    }

    const record = { line, message } satisfies ProtocolRecord;
    records.push(record);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(record)) continue;
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.resolve(record);
    }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    pending += text;
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      acceptLine(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const closePromise = new Promise<CliResult>((resolvePromise, reject) => {
    child.once('error', (error) => {
      rejectWaiters(error);
      reject(error);
    });
    child.once('close', (code) => {
      openProtocolProcesses.delete(child);
      if (pending.trim().length > 0) acceptLine(pending);
      rejectWaiters(new Error(`Protocol process exited with code ${code ?? -1}.`));
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });

  return {
    records,
    send: (request) => {
      child.stdin.write(encodeRequest(request));
    },
    waitFor: async (predicate, description) => {
      const existing = records.find(predicate);
      if (existing !== undefined) return existing;
      if (decodeFailure !== undefined) throw decodeFailure;

      return new Promise<ProtocolRecord>((resolveRecord, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ${description}.`));
        }, 10_000);
        const waiter: ProtocolRecordWaiter = {
          predicate,
          resolve: resolveRecord,
          reject,
          timeout,
        };
        waiters.add(waiter);
      });
    },
    finish: async () => {
      child.stdin.end();
      const result = await closePromise;
      if (decodeFailure !== undefined) throw decodeFailure;
      return result;
    },
  };
}

async function terminateTestProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.stdin.destroy();
  if (process.platform === 'win32' && child.pid !== undefined) {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        child.kill('SIGKILL');
        resolvePromise();
      });
      killer.once('close', () => resolvePromise());
    });
    return;
  }

  child.kill('SIGKILL');
}

async function git(repository: string, ...args: string[]): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd: repository,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`git ${args.join(' ')} failed: ${stderr}`));
    });
  });
}

async function fixture(name: string): Promise<{ repository: string; database: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-cli-'));
  temporaryDirectories.push(directory);
  const repository = join(directory, 'repository');
  await cp(join(fixturesRoot, name), repository, { recursive: true });
  await git(repository, 'init', '--initial-branch=main', '--quiet');
  await git(repository, 'add', '.');
  await git(
    repository,
    '-c',
    'user.name=Verifier Test',
    '-c',
    'user.email=verifier@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'baseline',
  );
  return { repository, database: join(directory, 'history.sqlite3') };
}

async function withDatabasePath<T>(database: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env.VERIFY_DATABASE_PATH;
  process.env.VERIFY_DATABASE_PATH = database;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.VERIFY_DATABASE_PATH;
    else process.env.VERIFY_DATABASE_PATH = previous;
  }
}

function withoutVolatileProfileFields(result: ProjectProfileResult): unknown {
  if (result.status === 'cancelled') return result;
  return {
    ...result,
    profile: {
      ...result.profile,
      generatedAt: '<generated-at>',
      scan: { ...result.profile.scan, elapsedMs: 0 },
    },
  };
}

function withoutVolatilePlanFields(result: VerificationPlanPreviewResult): unknown {
  if (result.status === 'cancelled') return result;
  return {
    ...result,
    preview: {
      ...result.preview,
      profile: {
        ...result.preview.profile,
        generatedAt: '<generated-at>',
        scan: { ...result.preview.profile.scan, elapsedMs: 0 },
      },
      plans: {
        quick: { ...result.preview.plans.quick, profileGeneratedAt: '<generated-at>' },
        full: { ...result.preview.plans.full, profileGeneratedAt: '<generated-at>' },
      },
    },
  };
}

async function runCli(args: string[], database: string): Promise<CliResult> {
  const previousDatabase = process.env.VERIFY_DATABASE_PATH;
  process.env.VERIFY_DATABASE_PATH = database;
  const composition = createApplicationComposition();
  openCompositions.push(composition);
  let stdout = '';
  let stderr = '';
  let code = 0;
  const io: CliIo = {
    writeOut: (value) => {
      stdout += value;
    },
    writeError: (value) => {
      stderr += value;
    },
    setExitCode: (nextCode) => {
      code = nextCode;
      process.exitCode = nextCode;
    },
  };

  try {
    await executeCli(args, { application: composition.application, io });
  } finally {
    composition.close();
    openCompositions.splice(openCompositions.indexOf(composition), 1);
    process.exitCode = undefined;
    if (previousDatabase === undefined) delete process.env.VERIFY_DATABASE_PATH;
    else process.env.VERIFY_DATABASE_PATH = previousDatabase;
  }
  return { code, stdout, stderr };
}

afterEach(async () => {
  await Promise.all([...openProtocolProcesses].map((child) => terminateTestProcess(child)));
  openProtocolProcesses.clear();
  while (openCompositions.length > 0) openCompositions.pop()?.close();
  process.exitCode = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('actual CLI workflow', () => {
  it.each([
    [['--help'], 'Usage: verify'],
    [['--version'], '0.1.0'],
  ])('treats %s as a successful informational command', async (args, expectedOutput) => {
    const { database } = await fixture('basic-pass');
    const result = await runCli(args, database);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(expectedOutput);
  });

  it('returns interruption exit 3 when plan profiling is cancelled', async () => {
    const { repository, database } = await fixture('project-intelligence/node-vite-vitest');
    let signalProfilerStarted: (() => void) | undefined;
    const profilerStarted = new Promise<void>((resolvePromise) => {
      signalProfilerStarted = resolvePromise;
    });
    const composition = createApplicationComposition({
      profiler: {
        profile: ({ signal }) =>
          new Promise<ProjectProfileResult>((resolvePromise) => {
            signalProfilerStarted?.();
            if (signal?.aborted === true) {
              resolvePromise({ status: 'cancelled' });
              return;
            }
            signal?.addEventListener('abort', () => resolvePromise({ status: 'cancelled' }), {
              once: true,
            });
          }),
      },
    });
    openCompositions.push(composition);
    const previousDatabase = process.env.VERIFY_DATABASE_PATH;
    process.env.VERIFY_DATABASE_PATH = database;
    let stdout = '';
    let stderr = '';
    let code = 0;
    const io: CliIo = {
      writeOut: (value) => {
        stdout += value;
      },
      writeError: (value) => {
        stderr += value;
      },
      setExitCode: (nextCode) => {
        code = nextCode;
        process.exitCode = nextCode;
      },
    };

    try {
      const execution = executeCli(['plan', repository, '--json'], {
        application: composition.application,
        io,
      });
      await profilerStarted;
      process.emit('SIGINT');
      await execution;

      expect(code).toBe(3);
      expect(stderr).toBe('');
      expect(JSON.parse(stdout)).toEqual({ status: 'cancelled' });
      await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      composition.close();
      openCompositions.splice(openCompositions.indexOf(composition), 1);
      process.exitCode = undefined;
      if (previousDatabase === undefined) delete process.env.VERIFY_DATABASE_PATH;
      else process.env.VERIFY_DATABASE_PATH = previousDatabase;
    }
  });

  it('initializes, inspects, runs, gates, and reloads persisted history', async () => {
    const { repository, database } = await fixture('git-changes');

    const initialization = await runCli(['init', repository, '--json'], database);
    expect(initialization.code).toBe(0);
    const initialized = JSON.parse(initialization.stdout) as {
      config: { suites: Record<string, { command: string }> };
    };
    expect(initialized.config.suites.test?.command).toBe('npm test');
    expect(await readFile(join(repository, '.verify', 'project.yml'), 'utf8')).toContain(
      'version: 1',
    );

    await writeFile(join(repository, 'src', 'tracked.js'), 'export const tracked = false;\n');
    await writeFile(join(repository, 'src', 'staged.js'), 'export const staged = "changed";\n');
    await git(repository, 'add', 'src/staged.js');

    const inspection = await runCli(['inspect', repository, '--json'], database);
    const change = JSON.parse(inspection.stdout) as {
      filesChanged: number;
      stagedFiles: number;
      unstagedFiles: number;
      files: { path: string }[];
    };
    expect(change.filesChanged).toBeGreaterThanOrEqual(3);
    expect(change.stagedFiles).toBe(1);
    expect(change.unstagedFiles).toBeGreaterThanOrEqual(2);
    expect(change.files.map((file) => file.path)).toContain('src/tracked.js');

    const execution = await runCli(['run', repository, '--json'], database);
    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe('');
    expect(execution.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    const run = JSON.parse(execution.stdout) as { id: string; gate: { status: string } };
    expect(run.gate.status).toBe('PASS');

    const gate = await runCli(['gate', repository, '--json'], database);
    expect(gate.code).toBe(0);
    expect(JSON.parse(gate.stdout)).toMatchObject({ status: 'PASS' });

    const history = await runCli(['history', repository, '--json'], database);
    const persistedHistory = JSON.parse(history.stdout) as {
      id: string;
      gate?: { status: string };
    }[];
    expect(persistedHistory[0]).toMatchObject({ id: run.id, gate: { status: 'PASS' } });
  }, 20_000);

  it.each([
    ['failing-test', 'test'],
    ['failing-build', 'build'],
  ])('returns exit 1 and BLOCK for the %s fixture', async (name, failedCheck) => {
    const { repository, database } = await fixture(name);
    const execution = await runCli(['run', repository, '--json'], database);
    const run = JSON.parse(execution.stdout) as {
      gate: { status: string };
      checks: { id: string; status: string }[];
    };

    expect(execution.code).toBe(1);
    expect(run.gate.status).toBe('BLOCK');
    expect(run.checks).toContainEqual(
      expect.objectContaining({ id: failedCheck, status: 'failed' }),
    );
  });

  it('returns WARN with exit 0 for a warn-policy failure', async () => {
    const { repository, database } = await fixture('basic-pass');
    await writeFile(
      join(repository, 'scripts', 'lint.mjs'),
      "process.stderr.write('intentional lint warning\\n');\nprocess.exitCode = 9;\n",
    );

    const execution = await runCli(['run', repository, '--json'], database);
    expect(execution.code).toBe(0);
    expect(JSON.parse(execution.stdout)).toMatchObject({ gate: { status: 'WARN' } });
  });

  it('persists a PASS to BLOCK to PASS repair cycle in one repository', async () => {
    const { repository, database } = await fixture('basic-pass');
    const testScript = join(repository, 'scripts', 'test.mjs');
    const passingScript = await readFile(testScript, 'utf8');

    const initial = await runCli(['run', repository, '--json'], database);
    expect(initial.code).toBe(0);
    expect(JSON.parse(initial.stdout)).toMatchObject({ gate: { status: 'PASS' } });

    await writeFile(testScript, "process.stderr.write('broken test\\n');\nprocess.exitCode = 1;\n");
    const broken = await runCli(['run', repository, '--json'], database);
    expect(broken.code).toBe(1);
    expect(JSON.parse(broken.stdout)).toMatchObject({ gate: { status: 'BLOCK' } });

    await writeFile(testScript, passingScript);
    const repaired = await runCli(['run', repository, '--json'], database);
    expect(repaired.code).toBe(0);
    expect(JSON.parse(repaired.stdout)).toMatchObject({ gate: { status: 'PASS' } });

    const history = await runCli(['history', repository, '--json'], database);
    const statuses = (JSON.parse(history.stdout) as { gate?: { status: string } }[]).map(
      (run) => run.gate?.status,
    );
    expect(statuses).toEqual(['PASS', 'BLOCK', 'PASS']);
  }, 20_000);

  it('returns execution-error exit 2 when a configured executable is missing', async () => {
    const { repository, database } = await fixture('basic-pass');
    const path = join(repository, '.verify', 'project.yml');
    await writeFile(
      path,
      [
        'version: 1',
        'project:',
        '  name: missing-command-fixture',
        'suites:',
        '  test:',
        '    type: test',
        '    command: verify-command-that-cannot-exist-91a0dd',
        '    failure_policy: block',
        '',
      ].join('\n'),
    );

    const execution = await runCli(['run', repository, '--json'], database);
    const run = JSON.parse(execution.stdout) as { checks: { status: string }[] };
    expect(execution.code).toBe(2);
    expect(run.checks[0]?.status).toBe('error');
  });

  it('emits clear human output and one clean JSON document from the built CLI', async () => {
    const { repository, database } = await fixture('basic-pass');

    const human = await runCliProcess(['run', repository], database);
    expect(human.code).toBe(0);
    expect(human.stderr).toBe('');
    expect(human.stdout).toContain('Running test: npm test');
    expect(human.stdout).toContain('Quality Gate: PASS');

    const json = await runCliProcess(['run', repository, '--json'], database);
    expect(json.code).toBe(0);
    expect(json.stderr).toBe('');
    expect(json.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    const run = JSON.parse(json.stdout) as VerificationRun;
    expect(run).toMatchObject({
      status: 'completed',
      gate: { status: 'PASS' },
    });
    expect((await realpath(run.repositoryRoot)).toLowerCase()).toBe(
      (await realpath(repository)).toLowerCase(),
    );
    expect(json.stdout).not.toContain('Running Unit tests');
  }, 20_000);

  it('returns exit 2 and structured JSON for invalid configuration in the built CLI', async () => {
    const { repository, database } = await fixture('basic-pass');
    await writeFile(
      join(repository, '.verify', 'project.yml'),
      ['version: 99', 'project:', '  name: invalid-config', 'suites: {}', ''].join('\n'),
    );

    const result = await runCliProcess(['run', repository, '--json'], database);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: 'VERIFY_ERROR' },
    });
  });

  it('cancels an active built-CLI command and returns interruption exit 3', async () => {
    const { repository, database } = await fixture('basic-pass');
    const marker = join(repository, 'command-started.marker');
    await writeFile(
      join(repository, 'scripts', 'slow.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(process.env.VERIFY_TEST_STARTED, 'started');",
        'setInterval(() => undefined, 1_000);',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(repository, '.verify', 'project.yml'),
      [
        'version: 1',
        'project:',
        '  name: interruption-fixture',
        'suites:',
        '  test:',
        '    type: test',
        '    command: node scripts/slow.mjs',
        '    failure_policy: block',
        '',
      ].join('\n'),
    );

    const harness = join(repository, 'interrupt-built-cli.mjs');
    await writeFile(
      harness,
      [
        "import { existsSync } from 'node:fs';",
        'const deadline = Date.now() + 5_000;',
        'const interrupt = setInterval(() => {',
        "  if (existsSync(process.env.VERIFY_TEST_STARTED) && process.listenerCount('SIGINT') > 0) {",
        '    clearInterval(interrupt);',
        "    process.emit('SIGINT');",
        '  } else if (Date.now() >= deadline) {',
        '    clearInterval(interrupt);',
        '    process.exitCode = 91;',
        '  }',
        '}, 10);',
        `await import(${JSON.stringify(pathToFileURL(builtCliEntry).href)});`,
        'clearInterval(interrupt);',
        '',
      ].join('\n'),
    );

    const result = await runCliProcess(['run', repository, '--json'], database, {
      entry: harness,
      environment: { VERIFY_TEST_STARTED: marker },
    });
    const run = JSON.parse(result.stdout) as {
      status: string;
      checks: { status: string }[];
    };
    expect(result.code).toBe(3);
    expect(result.stderr).toBe('');
    expect(run.status).toBe('cancelled');
    expect(run.checks).toContainEqual(expect.objectContaining({ status: 'cancelled' }));
  }, 15_000);
});

describe('reviewable configuration migration interfaces', () => {
  it('exposes one deterministic no-write preview through core, CLI, and protocol', async () => {
    const { repository, database } = await fixture('basic-pass');
    const path = join(repository, '.verify', 'project.yml');
    const source = await readFile(path, 'utf8');
    const composition = createApplicationComposition();
    openCompositions.push(composition);

    const core = await composition.application.previewProjectConfigMigration(repository);
    const cli = await runCli(['config', 'migrate', repository, '--json'], database);
    expect(cli.code).toBe(0);
    expect(cli.stderr).toBe('');
    expect(JSON.parse(cli.stdout)).toEqual(core);

    const frames: string[] = [];
    await handleProtocolRequest(
      composition.application,
      {
        protocolVersion: PROTOCOL_VERSION,
        id: 'migration-preview',
        method: 'config.migrate.preview',
        params: { repository },
      },
      { write: (frame) => frames.push(frame), diagnostic: () => undefined },
    );
    expect(frames).toHaveLength(1);
    expect(decodeResultLine('config.migrate.preview', frames[0] ?? '')).toMatchObject({
      result: core,
    });

    expect(core).toMatchObject({ sourceVersion: 1, targetVersion: 2 });
    expect(core.sourceDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(core.targetDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(core.diff).toContain('version: 2');
    expect(await readFile(path, 'utf8')).toBe(source);
    await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the read-only 6A plan equivalent across a real Node/Vite/Vitest migration', async () => {
    const { repository, database } = await fixture('project-intelligence/node-vite-vitest');
    const configDirectory = join(repository, '.verify');
    const configPath = join(configDirectory, 'project.yml');
    const commandMarker = join(repository, 'migration-command-executed.marker');
    await mkdir(configDirectory);
    await writeFile(
      configPath,
      [
        'version: 1',
        'project:',
        '  name: profile-fixture',
        'suites:',
        '  test:',
        '    type: test',
        '    command: node never-migrate.mjs',
        '    failure_policy: block',
        '  lint:',
        '    type: lint',
        '    command: npm run lint',
        '    failure_policy: warn',
        '  typecheck:',
        '    type: typecheck',
        '    command: npm run typecheck',
        '    failure_policy: block',
        '  build:',
        '    type: build',
        '    command: npm run build',
        '    failure_policy: block',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(repository, 'never-migrate.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync('migration-command-executed.marker', 'unexpected');",
        '',
      ].join('\n'),
    );

    const before = await runCliProcess(['plan', repository, '--json'], database);
    expect(before).toMatchObject({ code: 0, stderr: '' });
    const beforePlan = JSON.parse(before.stdout) as VerificationPlanPreviewResult;
    const source = await readFile(configPath, 'utf8');

    const previewResult = await runCliProcess(
      ['config', 'migrate', repository, '--json'],
      database,
    );
    expect(previewResult).toMatchObject({ code: 0, stderr: '' });
    const preview = JSON.parse(previewResult.stdout) as ProtocolResultMap['config.migrate.preview'];
    expect(await readFile(configPath, 'utf8')).toBe(source);

    const apply = await runCliProcess(
      [
        'config',
        'migrate',
        repository,
        '--apply',
        '--expected-digest',
        preview.sourceDigest,
        '--expected-target-digest',
        preview.targetDigest,
        '--json',
      ],
      database,
    );
    expect(apply).toMatchObject({ code: 0, stderr: '' });

    const after = await runCliProcess(['plan', repository, '--json'], database);
    expect(after).toMatchObject({ code: 0, stderr: '' });
    const afterPlan = JSON.parse(after.stdout) as VerificationPlanPreviewResult;
    expect(withoutVolatilePlanFields(afterPlan)).toStrictEqual(
      withoutVolatilePlanFields(beforePlan),
    );
    await expect(readFile(commandMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('requires both reviewed digests before apply and keeps migrated suites runnable', async () => {
    const { repository, database } = await fixture('basic-pass');
    const previewCli = await runCli(['config', 'migrate', repository, '--json'], database);
    const preview = JSON.parse(previewCli.stdout) as ProtocolResultMap['config.migrate.preview'];

    const missingReview = await runCliProcess(
      ['config', 'migrate', repository, '--apply', '--json'],
      database,
    );
    expect(missingReview.code).toBe(2);
    expect(JSON.parse(missingReview.stdout)).toMatchObject({ error: { code: 'VERIFY_ERROR' } });
    expect(await readFile(preview.path, 'utf8')).toContain('version: 1');

    const humanPreview = await runCli(['config', 'migrate', repository], database);
    expect(humanPreview.stdout).toContain(preview.diff);
    expect(humanPreview.stdout).toContain(preview.sourceDigest);
    expect(humanPreview.stdout).toContain(preview.targetDigest);

    const appliedCli = await runCli(
      [
        'config',
        'migrate',
        repository,
        '--apply',
        '--expected-digest',
        preview.sourceDigest,
        '--expected-target-digest',
        preview.targetDigest,
        '--json',
      ],
      database,
    );
    expect(appliedCli.code).toBe(0);
    const applied = JSON.parse(appliedCli.stdout) as ProtocolResultMap['config.migrate.apply'];
    expect(applied).toMatchObject({
      version: 2,
      sourceDigest: preview.sourceDigest,
      targetDigest: preview.targetDigest,
      config: { suites: { test: { command: 'npm test' } } },
    });
    expect(await readFile(preview.path, 'utf8')).toBe(preview.targetYaml);

    const composition = createApplicationComposition();
    openCompositions.push(composition);
    const policy = await composition.application.getProjectPolicy(repository);
    expect(policy).toMatchObject({ exists: true, config: applied.config });
    const frames: string[] = [];
    await handleProtocolRequest(
      composition.application,
      {
        protocolVersion: PROTOCOL_VERSION,
        id: 'version-aware-policy',
        method: 'config.policy.get',
        params: { repository },
      },
      { write: (frame) => frames.push(frame), diagnostic: () => undefined },
    );
    expect(decodeResultLine('config.policy.get', frames[0] ?? '')).toMatchObject({
      result: policy,
    });

    // Migration changes the policy version, not the legacy named-suite run semantics.
    const run = await runCli(['run', repository, '--json'], database);
    expect(run.code).toBe(0);
    const result = JSON.parse(run.stdout) as VerificationRun;
    expect(result.gate).toMatchObject({ status: 'PASS' });
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'test', command: 'npm test' }),
    );
  }, 20_000);

  it('rejects stale source edits through a structured protocol conflict', async () => {
    const { repository, database } = await fixture('basic-pass');
    const composition = createApplicationComposition();
    openCompositions.push(composition);
    const preview = await composition.application.previewProjectConfigMigration(repository);
    const source = await readFile(preview.path, 'utf8');
    await writeFile(preview.path, `${source}# manual comment after preview\n`);

    const staleCli = await runCliProcess(
      [
        'config',
        'migrate',
        repository,
        '--apply',
        '--expected-digest',
        preview.sourceDigest,
        '--expected-target-digest',
        preview.targetDigest,
        '--json',
      ],
      database,
    );
    expect(staleCli).toMatchObject({ code: 2, stderr: '' });
    expect(JSON.parse(staleCli.stdout)).toMatchObject({
      error: { code: 'MIGRATION_STALE' },
    });

    const frames: string[] = [];
    await handleProtocolRequest(
      composition.application,
      {
        protocolVersion: PROTOCOL_VERSION,
        id: 'stale-apply',
        method: 'config.migrate.apply',
        params: {
          repository,
          expectedSourceDigest: preview.sourceDigest,
          expectedTargetDigest: preview.targetDigest,
        },
      },
      { write: (frame) => frames.push(frame), diagnostic: () => undefined },
    );
    expect(decodeResultLine('config.migrate.apply', frames[0] ?? '')).toMatchObject({
      error: { code: 'MIGRATION_STALE' },
    });
    expect(await readFile(preview.path, 'utf8')).toBe(`${source}# manual comment after preview\n`);
    await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('explicit executable-policy approval interfaces', () => {
  it('keeps migration unapproved and exposes one normalized status through core, CLI, and protocol', async () => {
    const { repository, database } = await fixture('basic-pass');
    await withDatabasePath(database, async () => {
      const composition = createApplicationComposition();
      openCompositions.push(composition);
      const legacy = await composition.application.getPolicyApprovalStatus(repository);
      expect(legacy).toMatchObject({ status: 'migration-required', policyVersion: 1 });
      const unavailable = await runCliProcess(
        [
          'config',
          'approval',
          'approve',
          repository,
          '--expected-digest',
          'a'.repeat(64),
          '--json',
        ],
        database,
      );
      expect(unavailable).toMatchObject({ code: 2, stderr: '' });
      expect(JSON.parse(unavailable.stdout)).toMatchObject({
        error: { code: 'APPROVAL_UNAVAILABLE' },
      });
      const unavailableFrames: string[] = [];
      await handleProtocolRequest(
        composition.application,
        {
          protocolVersion: PROTOCOL_VERSION,
          id: 'legacy-approval',
          method: 'config.approval.approve',
          params: { repository, expectedPolicyDigest: 'a'.repeat(64) },
        },
        { write: (frame) => unavailableFrames.push(frame), diagnostic: () => undefined },
      );
      expect(decodeResultLine('config.approval.approve', unavailableFrames[0] ?? '')).toMatchObject(
        {
          error: { code: 'APPROVAL_UNAVAILABLE' },
        },
      );
      const preview = await composition.application.previewProjectConfigMigration(repository);
      await composition.application.applyProjectConfigMigration({
        repository,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      });

      const core = await composition.application.getPolicyApprovalStatus(repository);
      expect(core).toMatchObject({
        policyExists: true,
        policyVersion: 2,
        status: 'not-approved',
        receipt: null,
      });
      const cli = await runCli(['config', 'approval', 'status', repository, '--json'], database);
      expect(cli).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(cli.stdout)).toEqual(core);

      const frames: string[] = [];
      await handleProtocolRequest(
        composition.application,
        {
          protocolVersion: PROTOCOL_VERSION,
          id: 'approval-status',
          method: 'config.approval.status',
          params: { repository },
        },
        { write: (frame) => frames.push(frame), diagnostic: () => undefined },
      );
      expect(decodeResultLine('config.approval.status', frames[0] ?? '')).toMatchObject({
        result: core,
      });

      const missingDigest = await runCliProcess(
        ['config', 'approval', 'approve', repository, '--json'],
        database,
      );
      expect(missingDigest).toMatchObject({ code: 2, stderr: '' });
      expect(JSON.parse(missingDigest.stdout)).toMatchObject({ error: { code: 'VERIFY_ERROR' } });
      expect(await composition.application.getPolicyApprovalStatus(repository)).toEqual(core);
    });
  });

  it('requires an explicit reviewed digest, reports stale edits, and revokes through all interfaces', async () => {
    const { repository, database } = await fixture('basic-pass');
    await withDatabasePath(database, async () => {
      const composition = createApplicationComposition();
      openCompositions.push(composition);
      const preview = await composition.application.previewProjectConfigMigration(repository);
      await composition.application.applyProjectConfigMigration({
        repository,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      });
      const before = await composition.application.getPolicyApprovalStatus(repository);
      if (before.policyDigest === null) throw new Error('Expected a schema-v2 executable digest.');

      const approve = await runCli(
        [
          'config',
          'approval',
          'approve',
          repository,
          '--expected-digest',
          before.policyDigest,
          '--json',
        ],
        database,
      );
      expect(approve).toMatchObject({ code: 0, stderr: '' });
      const approved = JSON.parse(approve.stdout) as ProtocolResultMap['config.approval.approve'];
      expect(approved).toMatchObject({ status: 'approved', policyDigest: before.policyDigest });
      const human = await runCli(['config', 'approval', 'status', repository], database);
      expect(human.stdout).toContain('Executable policy: Approved');
      expect(human.stdout).toContain(before.policyDigest);
      expect(human.stdout).toContain('test: npm test');
      expect(human.stdout).toContain('Quick plan suite order:');

      const policyPath = join(repository, '.verify', 'project.yml');
      const yaml = await readFile(policyPath, 'utf8');
      await writeFile(policyPath, `${yaml}# presentation-only edit\n`);
      expect(await composition.application.getPolicyApprovalStatus(repository)).toMatchObject({
        status: 'approved',
        policyDigest: before.policyDigest,
      });

      const edited = (await readFile(policyPath, 'utf8')).replace(
        'command: npm test',
        'command: npm run changed-test',
      );
      await writeFile(policyPath, edited);
      const outdated = await composition.application.getPolicyApprovalStatus(repository);
      expect(outdated.status).toBe('outdated');
      expect(outdated.policyDigest).not.toBe(before.policyDigest);
      expect(outdated.receipt?.policyDigest).toBe(before.policyDigest);

      const stale = await runCliProcess(
        [
          'config',
          'approval',
          'approve',
          repository,
          '--expected-digest',
          before.policyDigest,
          '--json',
        ],
        database,
      );
      expect(stale).toMatchObject({ code: 2, stderr: '' });
      expect(JSON.parse(stale.stdout)).toMatchObject({ error: { code: 'APPROVAL_STALE' } });

      const staleFrames: string[] = [];
      await handleProtocolRequest(
        composition.application,
        {
          protocolVersion: PROTOCOL_VERSION,
          id: 'approval-stale',
          method: 'config.approval.approve',
          params: { repository, expectedPolicyDigest: before.policyDigest },
        },
        { write: (frame) => staleFrames.push(frame), diagnostic: () => undefined },
      );
      expect(decodeResultLine('config.approval.approve', staleFrames[0] ?? '')).toMatchObject({
        error: { code: 'APPROVAL_STALE' },
      });

      const frames: string[] = [];
      await handleProtocolRequest(
        composition.application,
        {
          protocolVersion: PROTOCOL_VERSION,
          id: 'approval-revoke',
          method: 'config.approval.revoke',
          params: { repository },
        },
        { write: (frame) => frames.push(frame), diagnostic: () => undefined },
      );
      const revoked = decodeResultLine('config.approval.revoke', frames[0] ?? '');
      expect(revoked).toMatchObject({ result: { status: 'revoked' } });
      if (!('result' in revoked)) throw new Error('Expected a revocation result.');
      const cli = await runCli(['config', 'approval', 'status', repository, '--json'], database);
      expect(JSON.parse(cli.stdout)).toEqual(revoked.result);
      expect(await composition.application.getPolicyApprovalStatus(repository)).toEqual(
        revoked.result,
      );
    });
  });
});

describe('approved Quick and Full verification interfaces', () => {
  it('fails closed for version-1 and unapproved version-2 policy without executing a check', async () => {
    const { repository, database } = await fixture('basic-pass');
    await withDatabasePath(database, async () => {
      const composition = createApplicationComposition();
      openCompositions.push(composition);
      const legacy = await runCliProcess(['quick', repository, '--json'], database);
      expect(legacy).toMatchObject({ code: 2, stderr: '' });
      expect(JSON.parse(legacy.stdout)).toMatchObject({
        error: { code: 'APPROVAL_UNAVAILABLE' },
      });

      const preview = await composition.application.previewProjectConfigMigration(repository);
      await composition.application.applyProjectConfigMigration({
        repository,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      });
      const unapproved = await runCliProcess(['full', repository, '--json'], database);
      expect(unapproved).toMatchObject({ code: 2, stderr: '' });
      expect(JSON.parse(unapproved.stdout)).toMatchObject({
        error: { code: 'APPROVAL_UNAVAILABLE' },
      });
      expect(await composition.application.getRunHistory(repository)).toEqual([]);
    });
  });

  it('runs only approved mode suites through one core, CLI, and protocol execution path', async () => {
    const { repository, database } = await fixture('basic-pass');
    await withDatabasePath(database, async () => {
      const composition = createApplicationComposition();
      openCompositions.push(composition);
      const preview = await composition.application.previewProjectConfigMigration(repository);
      await composition.application.applyProjectConfigMigration({
        repository,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      });
      const status = await composition.application.getPolicyApprovalStatus(repository);
      if (status.policyDigest === null) throw new Error('Expected a schema-v2 policy digest.');
      await composition.application.approveProjectPolicy({
        repository,
        expectedPolicyDigest: status.policyDigest,
      });

      const quick = await runCliProcess(['quick', repository, '--json'], database);
      expect(quick).toMatchObject({ code: 0, stderr: '' });
      const quickRun = JSON.parse(quick.stdout) as VerificationRun;
      expect(quickRun.checks.map((check) => check.id)).toEqual(['test', 'lint']);
      expect(quickRun.gate?.status).toBe('PASS');

      const full = await runCliProcess(['full', repository, '--json'], database);
      expect(full).toMatchObject({ code: 0, stderr: '' });
      const fullRun = JSON.parse(full.stdout) as VerificationRun;
      expect(fullRun.checks.map((check) => check.id)).toEqual(['test', 'lint', 'build']);
      expect(fullRun.gate?.status).toBe('PASS');

      const frames: string[] = [];
      await handleProtocolRequest(
        composition.application,
        {
          protocolVersion: PROTOCOL_VERSION,
          id: 'approved-quick',
          method: 'verification.plan.run',
          params: { repository, mode: 'quick' },
        },
        { write: (frame) => frames.push(frame), diagnostic: () => undefined },
      );
      const terminal = decodeResultLine('verification.plan.run', frames.at(-1) ?? '');
      if ('error' in terminal) throw new Error(terminal.error.message);
      expect(terminal.result.checks.map((check) => check.id)).toEqual(
        quickRun.checks.map((check) => check.id),
      );
      expect(frames.some((frame) => frame.includes('"event":"check.started"'))).toBe(true);
      expect(frames.some((frame) => frame.includes('"event":"run.completed"'))).toBe(true);
      const history = await composition.application.getRunHistory(repository);
      expect(history.map((run) => run.id)).toContain(terminal.result.id);
    });
  }, 20_000);

  it('rejects stale and revoked approval without invoking previously reviewed commands', async () => {
    const { repository, database } = await fixture('basic-pass');
    await withDatabasePath(database, async () => {
      const composition = createApplicationComposition();
      openCompositions.push(composition);
      const preview = await composition.application.previewProjectConfigMigration(repository);
      await composition.application.applyProjectConfigMigration({
        repository,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      });
      const policy = await composition.application.getPolicyApprovalStatus(repository);
      if (policy.policyDigest === null) throw new Error('Expected a schema-v2 policy digest.');
      await composition.application.approveProjectPolicy({
        repository,
        expectedPolicyDigest: policy.policyDigest,
      });
      const policyPath = join(repository, '.verify', 'project.yml');
      const source = await readFile(policyPath, 'utf8');
      await writeFile(policyPath, source.replace('command: npm test', 'command: npm run changed'));

      const stale = await runCliProcess(['quick', repository, '--json'], database);
      expect(stale).toMatchObject({ code: 2, stderr: '' });
      expect(JSON.parse(stale.stdout)).toMatchObject({
        error: { code: 'APPROVAL_UNAVAILABLE' },
      });
      expect(await composition.application.getRunHistory(repository)).toEqual([]);

      await composition.application.revokeProjectPolicyApproval(repository);
      await writeFile(policyPath, source);
      const revoked = await runCliProcess(['full', repository, '--json'], database);
      expect(revoked).toMatchObject({ code: 2, stderr: '' });
      expect(JSON.parse(revoked.stdout)).toMatchObject({
        error: { code: 'APPROVAL_UNAVAILABLE' },
      });
      expect(await composition.application.getRunHistory(repository)).toEqual([]);
    });
  });

  it('cancels an active approved Quick run and persists its correlated BLOCK terminal without starting later suites', async () => {
    const { repository, database } = await fixture('basic-pass');
    const laterCheckMarker = join(repository, 'approved-later-check.marker');
    await writeFile(
      join(repository, 'scripts', 'approved-slow.mjs'),
      [
        "process.stdout.write('approved slow command started\\n');",
        'setInterval(() => undefined, 1_000);',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(repository, 'scripts', 'approved-later.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(process.env.VERIFY_LATER_CHECK_MARKER, 'started');",
        '',
      ].join('\n'),
    );

    await withDatabasePath(database, async () => {
      const composition = createApplicationComposition();
      openCompositions.push(composition);
      const preview = await composition.application.previewProjectConfigMigration(repository);
      await composition.application.applyProjectConfigMigration({
        repository,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      });
      const policyPath = join(repository, '.verify', 'project.yml');
      const policy = await readFile(policyPath, 'utf8');
      await writeFile(
        policyPath,
        policy
          .replace('command: npm test', 'command: node scripts/approved-slow.mjs')
          .replace('command: npm run lint', 'command: node scripts/approved-later.mjs'),
      );
      const status = await composition.application.getPolicyApprovalStatus(repository);
      if (status.policyDigest === null) throw new Error('Expected a schema-v2 policy digest.');
      await composition.application.approveProjectPolicy({
        repository,
        expectedPolicyDigest: status.policyDigest,
      });
    });

    const protocol = startProtocolProcess(database, {
      VERIFY_LATER_CHECK_MARKER: laterCheckMarker,
    });
    const runRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'approved-quick-cancellation',
      method: 'verification.plan.run',
      params: { repository, mode: 'quick' },
    } satisfies ProtocolRequest<'verification.plan.run'>;
    protocol.send(runRequest);
    await protocol.waitFor(
      ({ message }) =>
        message.id === runRequest.id &&
        'event' in message &&
        message.event === 'check.output' &&
        message.data.checkId === 'test',
      'approved slow-check output',
    );

    const cancelRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-approved-quick',
      method: 'verification.cancel',
      params: { targetRequestId: runRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    protocol.send(cancelRequest);
    expect(
      decodeResultLine(
        'verification.cancel',
        (
          await protocol.waitFor(
            ({ message }) => message.id === cancelRequest.id && 'result' in message,
            'approved Quick cancellation acknowledgement',
          )
        ).line,
      ),
    ).toMatchObject({ result: { accepted: true } });

    const terminal = decodeResultLine(
      'verification.plan.run',
      (
        await protocol.waitFor(
          ({ message }) => message.id === runRequest.id && 'result' in message,
          'approved Quick cancelled terminal',
        )
      ).line,
    );
    if ('error' in terminal) throw new Error(terminal.error.message);
    const completed = protocol.records.find(
      ({ message }) =>
        message.id === runRequest.id && 'event' in message && message.event === 'run.completed',
    );
    expect(completed).toBeDefined();
    if (
      completed === undefined ||
      !('event' in completed.message) ||
      completed.message.event !== 'run.completed'
    ) {
      throw new Error('The approved cancelled run did not emit run.completed.');
    }
    expect(terminal.result).toStrictEqual(completed.message.data.run);
    expect(terminal.result).toMatchObject({
      status: 'cancelled',
      gate: { status: 'BLOCK' },
      checks: [{ id: 'test', status: 'cancelled' }],
    });
    expect(
      protocol.records.some(
        ({ message }) =>
          message.id === runRequest.id &&
          'event' in message &&
          message.event === 'check.started' &&
          message.data.check.id === 'lint',
      ),
    ).toBe(false);

    const execution = await protocol.finish();
    expect(execution).toMatchObject({ code: 0, stderr: '' });
    expect(
      protocol.records.filter(({ message }) => message.id === runRequest.id && 'result' in message),
    ).toHaveLength(1);
    await expect(readFile(laterCheckMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const history = JSON.parse(
      (await runCliProcess(['history', repository, '--json'], database)).stdout,
    ) as VerificationRun[];
    expect(history).toContainEqual(terminal.result);
  }, 25_000);
});

describe('built child-process protocol', () => {
  it('exposes one read-only plan preview equivalently through core, CLI, and protocol', async () => {
    const { repository, database } = await fixture('project-intelligence/node-vite-vitest');
    const commandMarker = join(repository, 'planning-command-executed.marker');
    const manifestPath = join(repository, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    manifest.scripts.test = 'node never-plan.mjs';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(
      join(repository, 'never-plan.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync('planning-command-executed.marker', 'unexpected');",
        '',
      ].join('\n'),
    );
    const statusBefore = await git(repository, 'status', '--short', '--untracked-files=all');

    const cli = await runCliProcess(['plan', repository, '--json'], database);
    expect(cli).toMatchObject({ code: 0, stderr: '' });
    expect(cli.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    const cliResult = JSON.parse(cli.stdout) as VerificationPlanPreviewResult;
    if (cliResult.status !== 'completed') throw new Error('The CLI plan preview was cancelled.');
    expect(cliResult.preview.plans.quick).toMatchObject({
      mode: 'quick',
      status: 'ready',
    });
    expect(cliResult.preview.plans.quick.selectedChecks.map(({ kind }) => kind)).toEqual([
      'test',
      'lint',
    ]);
    expect(cliResult.preview.plans.quick.skippedChecks.map(({ kind }) => kind)).toEqual([
      'typecheck',
      'build',
    ]);
    expect(cliResult.preview.plans.full.selectedChecks.map(({ kind }) => kind)).toEqual([
      'test',
      'lint',
      'typecheck',
      'build',
    ]);
    expect(cliResult.preview.plans.full.skippedChecks).toEqual([]);
    expect(cliResult.preview.plans.quick.selectedChecks).toContainEqual(
      expect.objectContaining({ kind: 'test', command: 'node never-plan.mjs' }),
    );

    const observedCommands = new Set(
      cliResult.preview.profile.taskCandidates.map(({ command }) => command),
    );
    for (const plan of Object.values(cliResult.preview.plans)) {
      for (const decision of [...plan.selectedChecks, ...plan.skippedChecks]) {
        expect(observedCommands.has(decision.command)).toBe(true);
        expect(decision.reason.length).toBeGreaterThan(0);
        expect(decision.taskCandidateId.length).toBeGreaterThan(0);
        expect(decision.evidenceIds.length).toBeGreaterThan(0);
      }
    }

    const human = await runCliProcess(['plan', repository], database);
    expect(human).toMatchObject({ code: 0, stderr: '' });
    expect(human.stdout).toContain('Verification Plan Preview (read-only)');
    expect(human.stdout).toContain('Quick plan: READY');
    expect(human.stdout).toContain('Full plan: READY');
    expect(human.stdout).toContain('Skipped in Quick mode');

    const composition = createApplicationComposition();
    openCompositions.push(composition);
    const coreResult = await composition.application.previewVerificationPlans({ repository });

    const protocol = startProtocolProcess(database);
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'plan-equivalence',
      method: 'verification.plan',
      params: { repository },
    } satisfies ProtocolRequest<'verification.plan'>;
    protocol.send(request);
    const terminal = decodeResultLine(
      'verification.plan',
      (
        await protocol.waitFor(
          ({ message }) => message.id === request.id && 'result' in message,
          'verification plan terminal result',
        )
      ).line,
    );
    if ('error' in terminal) throw new Error(terminal.error.message);
    const execution = await protocol.finish();

    expect(execution).toMatchObject({ code: 0, stderr: '' });
    expect(
      protocol.records.some(
        ({ message }) =>
          message.id === request.id &&
          'event' in message &&
          message.event === 'profile.progress' &&
          message.data.phase === 'sensors',
      ),
    ).toBe(true);
    expect(withoutVolatilePlanFields(terminal.result)).toStrictEqual(
      withoutVolatilePlanFields(cliResult),
    );
    expect(withoutVolatilePlanFields(coreResult)).toStrictEqual(
      withoutVolatilePlanFields(cliResult),
    );
    expect(await git(repository, 'status', '--short', '--untracked-files=all')).toBe(statusBefore);
    await expect(readFile(commandMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(repository, '.verify', 'project.yml'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${database}-wal`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${database}-shm`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('cancels a registered plan preview only through operation.cancel', async () => {
    const { repository, database } = await fixture('project-intelligence/node-vite-vitest');
    const protocol = startProtocolProcess(database);
    const planRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-plan',
      method: 'verification.plan',
      params: { repository },
    } satisfies ProtocolRequest<'verification.plan'>;
    const verificationSpecificCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'wrong-plan-cancel',
      method: 'verification.cancel',
      params: { targetRequestId: planRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    const acceptedCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'general-plan-cancel',
      method: 'operation.cancel',
      params: { targetRequestId: planRequest.id },
    } satisfies ProtocolRequest<'operation.cancel'>;
    const duplicateCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'general-plan-cancel-again',
      method: 'operation.cancel',
      params: { targetRequestId: planRequest.id },
    } satisfies ProtocolRequest<'operation.cancel'>;

    protocol.send(planRequest);
    protocol.send(verificationSpecificCancel);
    protocol.send(acceptedCancel);
    protocol.send(duplicateCancel);

    expect(
      decodeResultLine(
        'verification.cancel',
        (
          await protocol.waitFor(
            ({ message }) => message.id === verificationSpecificCancel.id && 'result' in message,
            'verification-specific plan cancellation rejection',
          )
        ).line,
      ),
    ).toMatchObject({ result: { accepted: false } });
    expect(
      decodeResultLine(
        'operation.cancel',
        (
          await protocol.waitFor(
            ({ message }) => message.id === acceptedCancel.id && 'result' in message,
            'general plan cancellation acknowledgement',
          )
        ).line,
      ),
    ).toMatchObject({ result: { accepted: true } });
    expect(
      decodeResultLine(
        'operation.cancel',
        (
          await protocol.waitFor(
            ({ message }) => message.id === duplicateCancel.id && 'result' in message,
            'duplicate plan cancellation rejection',
          )
        ).line,
      ),
    ).toMatchObject({ result: { accepted: false } });

    const terminal = decodeResultLine(
      'verification.plan',
      (
        await protocol.waitFor(
          ({ message }) => message.id === planRequest.id && 'result' in message,
          'cancelled plan terminal result',
        )
      ).line,
    );
    expect(terminal).toMatchObject({ result: { status: 'cancelled' } });

    const execution = await protocol.finish();
    expect(execution).toMatchObject({ code: 0, stderr: '' });
    await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15_000);

  it('exposes one read-only Node/Vite/Vitest profile through CLI and protocol without storage', async () => {
    const { repository, database } = await fixture('project-intelligence/node-vite-vitest');
    const commandMarker = join(repository, 'profiling-command-executed.marker');
    const manifestPath = join(repository, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    manifest.scripts.test = 'node never-profile.mjs';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(
      join(repository, 'never-profile.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync('profiling-command-executed.marker', 'unexpected');",
        '',
      ].join('\n'),
    );
    const statusBefore = await git(repository, 'status', '--short', '--untracked-files=all');

    const cli = await runCliProcess(['understand', repository, '--json'], database);
    expect(cli).toMatchObject({ code: 0, stderr: '' });
    expect(cli.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    const cliResult = projectProfileResultSchema.parse(JSON.parse(cli.stdout));
    if (cliResult.status !== 'completed') throw new Error('The CLI profile was cancelled.');
    expect(cliResult.profile.capabilities.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'runtime.node',
        'package-manager.pnpm',
        'framework.vite',
        'test-framework.vitest',
      ]),
    );
    expect(cliResult.profile.taskCandidates).toContainEqual(
      expect.objectContaining({ kind: 'test', command: 'node never-profile.mjs' }),
    );

    const protocol = startProtocolProcess(database);
    const request = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'profile-equivalence',
      method: 'project.profile',
      params: { repository },
    } satisfies ProtocolRequest<'project.profile'>;
    protocol.send(request);
    const terminal = decodeResultLine(
      'project.profile',
      (
        await protocol.waitFor(
          ({ message }) => message.id === request.id && 'result' in message,
          'project profile terminal result',
        )
      ).line,
    );
    if ('error' in terminal) throw new Error(terminal.error.message);
    const execution = await protocol.finish();

    expect(execution).toMatchObject({ code: 0, stderr: '' });
    expect(
      protocol.records.some(
        ({ message }) =>
          message.id === request.id &&
          'event' in message &&
          message.event === 'profile.progress' &&
          message.data.phase === 'sensors',
      ),
    ).toBe(true);
    expect(withoutVolatileProfileFields(terminal.result)).toStrictEqual(
      withoutVolatileProfileFields(cliResult),
    );
    expect(await git(repository, 'status', '--short', '--untracked-files=all')).toBe(statusBefore);
    await expect(readFile(commandMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(repository, '.verify', 'project.yml'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${database}-wal`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${database}-shm`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('correlates general profile cancellation while preserving verification-specific cancellation', async () => {
    const { repository, database } = await fixture('project-intelligence/node-vite-vitest');
    const protocol = startProtocolProcess(database);
    const profileRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-profile',
      method: 'project.profile',
      params: { repository },
    } satisfies ProtocolRequest<'project.profile'>;
    const verificationSpecificCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'wrong-method-cancel',
      method: 'verification.cancel',
      params: { targetRequestId: profileRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    const acceptedCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'general-cancel',
      method: 'operation.cancel',
      params: { targetRequestId: profileRequest.id },
    } satisfies ProtocolRequest<'operation.cancel'>;
    const duplicateCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'general-cancel-again',
      method: 'operation.cancel',
      params: { targetRequestId: profileRequest.id },
    } satisfies ProtocolRequest<'operation.cancel'>;

    protocol.send(profileRequest);
    protocol.send(verificationSpecificCancel);
    protocol.send(acceptedCancel);
    protocol.send(duplicateCancel);

    const wrongMethodResult = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === verificationSpecificCancel.id && 'result' in message,
          'verification-specific profile cancellation rejection',
        )
      ).line,
    );
    const acceptedResult = decodeResultLine(
      'operation.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === acceptedCancel.id && 'result' in message,
          'general profile cancellation acknowledgement',
        )
      ).line,
    );
    const duplicateResult = decodeResultLine(
      'operation.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === duplicateCancel.id && 'result' in message,
          'duplicate general cancellation rejection',
        )
      ).line,
    );
    const terminal = decodeResultLine(
      'project.profile',
      (
        await protocol.waitFor(
          ({ message }) => message.id === profileRequest.id && 'result' in message,
          'cancelled profile terminal result',
        )
      ).line,
    );

    expect(wrongMethodResult).toMatchObject({ result: { accepted: false } });
    expect(acceptedResult).toMatchObject({ result: { accepted: true } });
    expect(duplicateResult).toMatchObject({ result: { accepted: false } });
    expect(terminal).toMatchObject({ result: { status: 'cancelled' } });

    const postTerminalCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'general-cancel-after-terminal',
      method: 'operation.cancel',
      params: { targetRequestId: profileRequest.id },
    } satisfies ProtocolRequest<'operation.cancel'>;
    protocol.send(postTerminalCancel);
    expect(
      decodeResultLine(
        'operation.cancel',
        (
          await protocol.waitFor(
            ({ message }) => message.id === postTerminalCancel.id && 'result' in message,
            'post-terminal profile cancellation rejection',
          )
        ).line,
      ),
    ).toMatchObject({ result: { accepted: false } });

    const execution = await protocol.finish();
    expect(execution).toMatchObject({ code: 0, stderr: '' });
    await expect(readFile(database, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }, 15_000);

  it('lets operation.cancel interrupt a registered verification run', async () => {
    const { repository, database } = await fixture('basic-pass');
    const protocol = startProtocolProcess(database);
    const runRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'general-cancel-run',
      method: 'verification.run',
      params: { repository },
    } satisfies ProtocolRequest<'verification.run'>;
    const cancelRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'general-cancel-run-control',
      method: 'operation.cancel',
      params: { targetRequestId: runRequest.id },
    } satisfies ProtocolRequest<'operation.cancel'>;

    protocol.send(runRequest);
    protocol.send(cancelRequest);

    expect(
      decodeResultLine(
        'operation.cancel',
        (
          await protocol.waitFor(
            ({ message }) => message.id === cancelRequest.id && 'result' in message,
            'general verification cancellation acknowledgement',
          )
        ).line,
      ),
    ).toMatchObject({ result: { accepted: true } });
    const terminal = decodeResultLine(
      'verification.run',
      (
        await protocol.waitFor(
          ({ message }) => message.id === runRequest.id && 'result' in message,
          'generally cancelled verification terminal result',
        )
      ).line,
    );
    if ('error' in terminal) throw new Error(terminal.error.message);
    expect(terminal.result).toMatchObject({ status: 'cancelled', gate: { status: 'BLOCK' } });

    const execution = await protocol.finish();
    expect(execution).toMatchObject({ code: 0, stderr: '' });
    const history = JSON.parse(
      (await runCliProcess(['history', repository, '--json'], database)).stdout,
    ) as VerificationRun[];
    expect(history).toContainEqual(terminal.result);
  }, 15_000);

  it('streams correlated events, returns one terminal run, and persists that exact run', async () => {
    const { repository, database } = await fixture('basic-pass');
    const request: ProtocolRequest<'verification.run'> = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'child-process-protocol',
      method: 'verification.run',
      params: { repository },
    };

    const execution = await runCliProcess(['protocol'], database, {
      stdin: encodeRequest(request),
    });
    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe('');
    const lines = execution.stdout.trim().split(/\r?\n/u);
    const messages = lines.map((line) => decodeServerMessageLine(line));
    const terminalLines = lines.filter((line) => 'result' in decodeServerMessageLine(line));
    const completed = messages.find(
      (message) => 'event' in message && message.event === 'run.completed',
    );

    expect(messages.every((message) => message.id === request.id)).toBe(true);
    expect(messages.some((message) => 'event' in message && message.event === 'check.output')).toBe(
      true,
    );
    expect(terminalLines).toHaveLength(1);
    const terminal = decodeResultLine('verification.run', terminalLines[0] ?? '');
    if ('error' in terminal) throw new Error(terminal.error.message);
    const eventRun = completed && 'event' in completed ? completed.data.run : undefined;
    expect(terminal.result).toStrictEqual(eventRun);

    const history = await runCliProcess(['history', repository, '--json'], database);
    expect(history.code).toBe(0);
    const persistedHistory = JSON.parse(history.stdout) as unknown[];
    expect(persistedHistory[0]).toStrictEqual(terminal.result);
  }, 15_000);

  it('persists cancellation sent immediately after the first run frame before any check starts', async () => {
    const { repository, database } = await fixture('basic-pass');
    const protocol = startProtocolProcess(database);
    const runRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'immediate-run',
      method: 'verification.run',
      params: { repository },
    } satisfies ProtocolRequest<'verification.run'>;
    const cancelRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'immediate-cancel',
      method: 'verification.cancel',
      params: { targetRequestId: runRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;

    protocol.send(runRequest);
    protocol.send(cancelRequest);

    const cancellation = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === cancelRequest.id && 'result' in message,
          'immediate cancellation acknowledgement',
        )
      ).line,
    );
    expect(cancellation).toMatchObject({ result: { accepted: true } });

    const terminal = decodeResultLine(
      'verification.run',
      (
        await protocol.waitFor(
          ({ message }) => message.id === runRequest.id && 'result' in message,
          'immediately cancelled terminal result',
        )
      ).line,
    );
    if ('error' in terminal) throw new Error(terminal.error.message);
    expect(terminal.result).toMatchObject({
      status: 'cancelled',
      checks: [],
      gate: { status: 'BLOCK' },
    });
    expect(
      protocol.records.some(
        ({ message }) =>
          message.id === runRequest.id && 'event' in message && message.event === 'check.started',
      ),
    ).toBe(false);

    const execution = await protocol.finish();
    expect(execution).toMatchObject({ code: 0, stderr: '' });
    const history = JSON.parse(
      (await runCliProcess(['history', repository, '--json'], database)).stdout,
    ) as VerificationRun[];
    expect(history).toContainEqual(terminal.result);
  }, 15_000);

  it('persists accepted cancellation while an unapproved smart run is still authorizing', async () => {
    const { repository, database } = await fixture('basic-pass');
    const commandMarker = join(repository, 'pre-authorization-command.marker');
    await withDatabasePath(database, async () => {
      const composition = createApplicationComposition();
      openCompositions.push(composition);
      const preview = await composition.application.previewProjectConfigMigration(repository);
      await composition.application.applyProjectConfigMigration({
        repository,
        expectedSourceDigest: preview.sourceDigest,
        expectedTargetDigest: preview.targetDigest,
      });
      const policyPath = join(repository, '.verify', 'project.yml');
      const policy = await readFile(policyPath, 'utf8');
      await writeFile(
        policyPath,
        policy.replace('command: npm test', 'command: node scripts/pre-authorization-command.mjs'),
      );
      await writeFile(
        join(repository, 'scripts', 'pre-authorization-command.mjs'),
        [
          "import { writeFileSync } from 'node:fs';",
          "writeFileSync(process.env.VERIFY_PREAUTH_MARKER, 'executed');",
          '',
        ].join('\n'),
      );
    });

    const protocol = startProtocolProcess(database, {
      VERIFY_PREAUTH_MARKER: commandMarker,
    });
    const runRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'unapproved-pre-authorization-run',
      method: 'verification.plan.run',
      params: { repository, mode: 'quick' },
    } satisfies ProtocolRequest<'verification.plan.run'>;
    const cancelRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-unapproved-pre-authorization-run',
      method: 'verification.cancel',
      params: { targetRequestId: runRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;

    protocol.send(runRequest);
    protocol.send(cancelRequest);

    const cancellation = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === cancelRequest.id && 'result' in message,
          'unapproved pre-authorization cancellation acknowledgement',
        )
      ).line,
    );
    expect(cancellation).toMatchObject({ result: { accepted: true } });

    const terminal = decodeResultLine(
      'verification.plan.run',
      (
        await protocol.waitFor(
          ({ message }) =>
            message.id === runRequest.id && ('result' in message || 'error' in message),
          'unapproved pre-authorization cancelled terminal result',
        )
      ).line,
    );
    if ('error' in terminal) throw new Error(terminal.error.message);
    expect(terminal.result).toMatchObject({
      status: 'cancelled',
      checks: [],
      gate: { status: 'BLOCK' },
    });
    expect(
      protocol.records.some(
        ({ message }) =>
          message.id === runRequest.id &&
          'event' in message &&
          (message.event === 'check.started' || message.event === 'check.output'),
      ),
    ).toBe(false);

    const execution = await protocol.finish();
    expect(execution).toMatchObject({ code: 0, stderr: '' });
    await expect(readFile(commandMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const history = JSON.parse(
      (await runCliProcess(['history', repository, '--json'], database)).stdout,
    ) as VerificationRun[];
    expect(history).toContainEqual(terminal.result);
  }, 15_000);

  it('cancels during command output, persists the terminal run, and starts no later checks', async () => {
    const { repository, database } = await fixture('basic-pass');
    const laterCheckMarker = join(repository, 'later-check.marker');
    await writeFile(
      join(repository, 'scripts', 'protocol-slow.mjs'),
      [
        "process.stdout.write('slow command started\\n');",
        'setInterval(() => undefined, 1_000);',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(repository, 'scripts', 'protocol-later.mjs'),
      [
        "import { writeFileSync } from 'node:fs';",
        "writeFileSync(process.env.VERIFY_LATER_CHECK_MARKER, 'started');",
        '',
      ].join('\n'),
    );
    await writeFile(
      join(repository, '.verify', 'project.yml'),
      [
        'version: 1',
        'project:',
        '  name: protocol-cancellation-fixture',
        'suites:',
        '  slow:',
        '    type: test',
        '    command: node scripts/protocol-slow.mjs',
        '    failure_policy: block',
        '  later:',
        '    type: test',
        '    command: node scripts/protocol-later.mjs',
        '    failure_policy: block',
        '',
      ].join('\n'),
    );

    const protocol = startProtocolProcess(database, {
      VERIFY_LATER_CHECK_MARKER: laterCheckMarker,
    });

    const runRequest = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-during-output',
      method: 'verification.run',
      params: { repository },
    } satisfies ProtocolRequest<'verification.run'>;
    protocol.send(runRequest);
    await protocol.waitFor(
      ({ message }) =>
        message.id === runRequest.id &&
        'event' in message &&
        message.event === 'check.output' &&
        message.data.checkId === 'slow',
      'slow-check output',
    );

    const unknownCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-unknown',
      method: 'verification.cancel',
      params: { targetRequestId: 'missing-run' },
    } satisfies ProtocolRequest<'verification.cancel'>;
    const acceptedCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-active',
      method: 'verification.cancel',
      params: { targetRequestId: runRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    const duplicateCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-active-again',
      method: 'verification.cancel',
      params: { targetRequestId: runRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    protocol.send(unknownCancel);
    protocol.send(acceptedCancel);
    protocol.send(duplicateCancel);

    const unknownResult = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === unknownCancel.id && 'result' in message,
          'unknown-target cancellation result',
        )
      ).line,
    );
    const acceptedResult = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === acceptedCancel.id && 'result' in message,
          'accepted cancellation result',
        )
      ).line,
    );
    const duplicateResult = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === duplicateCancel.id && 'result' in message,
          'duplicate cancellation result',
        )
      ).line,
    );
    expect(unknownResult).toMatchObject({ result: { accepted: false } });
    expect(acceptedResult).toMatchObject({ result: { accepted: true } });
    expect(duplicateResult).toMatchObject({ result: { accepted: false } });

    const terminalRecord = await protocol.waitFor(
      ({ message }) => message.id === runRequest.id && 'result' in message,
      'cancelled run terminal result',
    );
    const terminal = decodeResultLine('verification.run', terminalRecord.line);
    if ('error' in terminal) throw new Error(terminal.error.message);
    const completedRecord = protocol.records.find(
      ({ message }) =>
        message.id === runRequest.id && 'event' in message && message.event === 'run.completed',
    );
    expect(completedRecord).toBeDefined();
    if (
      completedRecord === undefined ||
      !('event' in completedRecord.message) ||
      completedRecord.message.event !== 'run.completed'
    ) {
      throw new Error('The cancelled run did not emit run.completed.');
    }
    expect(terminal.result).toStrictEqual(completedRecord.message.data.run);
    expect(terminal.result).toMatchObject({
      status: 'cancelled',
      gate: { status: 'BLOCK' },
      checks: [{ id: 'slow', status: 'cancelled' }],
    });
    expect(
      protocol.records.some(
        ({ message }) =>
          message.id === runRequest.id &&
          'event' in message &&
          message.event === 'check.started' &&
          message.data.check.id === 'later',
      ),
    ).toBe(false);

    const postTerminalCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-after-terminal',
      method: 'verification.cancel',
      params: { targetRequestId: runRequest.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    protocol.send(postTerminalCancel);
    const postTerminalResult = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === postTerminalCancel.id && 'result' in message,
          'post-terminal cancellation result',
        )
      ).line,
    );
    expect(postTerminalResult).toMatchObject({ result: { accepted: false } });

    const execution = await protocol.finish();
    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe('');
    expect(
      protocol.records.filter(({ message }) => message.id === runRequest.id && 'result' in message),
    ).toHaveLength(1);
    await expect(readFile(laterCheckMarker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const history = await runCliProcess(['history', repository, '--json'], database);
    expect(history.code).toBe(0);
    expect(JSON.parse(history.stdout)).toContainEqual(terminal.result);
  }, 25_000);

  it('cancels a queued run before check start and rejects an active duplicate request id', async () => {
    const { repository, database } = await fixture('basic-pass');
    await writeFile(
      join(repository, 'scripts', 'protocol-queue-blocker.mjs'),
      [
        "process.stdout.write('queue blocked\\n');",
        'setInterval(() => undefined, 1_000);',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(repository, '.verify', 'project.yml'),
      [
        'version: 1',
        'project:',
        '  name: protocol-pre-start-cancellation-fixture',
        'suites:',
        '  blocker:',
        '    type: test',
        '    command: node scripts/protocol-queue-blocker.mjs',
        '    failure_policy: block',
        '',
      ].join('\n'),
    );

    const protocol = startProtocolProcess(database);
    const activeRun = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'active-run',
      method: 'verification.run',
      params: { repository },
    } satisfies ProtocolRequest<'verification.run'>;
    const queuedRun = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'queued-run',
      method: 'verification.run',
      params: { repository },
    } satisfies ProtocolRequest<'verification.run'>;
    protocol.send(activeRun);
    await protocol.waitFor(
      ({ message }) =>
        message.id === activeRun.id &&
        'event' in message &&
        message.event === 'check.output' &&
        message.data.checkId === 'blocker',
      'queue-blocker output',
    );

    protocol.send(queuedRun);
    protocol.send({
      protocolVersion: PROTOCOL_VERSION,
      id: activeRun.id,
      method: 'runs.list',
      params: { repository },
    });
    const duplicateError = await protocol.waitFor(
      ({ message }) => message.id === activeRun.id && 'error' in message,
      'active duplicate request rejection',
    );
    if (!('error' in duplicateError.message)) {
      throw new Error('The active duplicate request was not rejected.');
    }
    expect(duplicateError.message.error.code).toBe('INVALID_REQUEST');
    expect(duplicateError.message.error.message).toContain('already active');

    const queuedCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-queued-run',
      method: 'verification.cancel',
      params: { targetRequestId: queuedRun.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    protocol.send(queuedCancel);
    const queuedCancelResult = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === queuedCancel.id && 'result' in message,
          'queued cancellation result',
        )
      ).line,
    );
    expect(queuedCancelResult).toMatchObject({ result: { accepted: true } });

    const activeCancel = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'cancel-active-run',
      method: 'verification.cancel',
      params: { targetRequestId: activeRun.id },
    } satisfies ProtocolRequest<'verification.cancel'>;
    protocol.send(activeCancel);
    const activeCancelResult = decodeResultLine(
      'verification.cancel',
      (
        await protocol.waitFor(
          ({ message }) => message.id === activeCancel.id && 'result' in message,
          'active cancellation result',
        )
      ).line,
    );
    expect(activeCancelResult).toMatchObject({ result: { accepted: true } });

    const activeTerminal = decodeResultLine(
      'verification.run',
      (
        await protocol.waitFor(
          ({ message }) => message.id === activeRun.id && 'result' in message,
          'active run terminal result',
        )
      ).line,
    );
    const queuedTerminal = decodeResultLine(
      'verification.run',
      (
        await protocol.waitFor(
          ({ message }) => message.id === queuedRun.id && 'result' in message,
          'queued run terminal result',
        )
      ).line,
    );
    if ('error' in activeTerminal) throw new Error(activeTerminal.error.message);
    if ('error' in queuedTerminal) throw new Error(queuedTerminal.error.message);
    expect(queuedTerminal.result).toMatchObject({
      status: 'cancelled',
      checks: [],
      gate: {
        status: 'BLOCK',
        reasons: ['No verification checks were run.'],
        summary: { total: 0, cancelled: 0 },
      },
    });
    expect(
      protocol.records.some(
        ({ message }) =>
          message.id === queuedRun.id &&
          'event' in message &&
          (message.event === 'check.started' ||
            message.event === 'check.output' ||
            message.event === 'check.completed'),
      ),
    ).toBe(false);

    const execution = await protocol.finish();
    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe('');
    const history = JSON.parse(
      (await runCliProcess(['history', repository, '--json'], database)).stdout,
    ) as VerificationRun[];
    expect(history).toEqual(expect.arrayContaining([activeTerminal.result, queuedTerminal.result]));
  }, 25_000);
});

describe('desktop protocol equivalence', () => {
  it('streams and returns the exact run persisted by the shared application', async () => {
    const { repository, database } = await fixture('basic-pass');
    const previousDatabase = process.env.VERIFY_DATABASE_PATH;
    process.env.VERIFY_DATABASE_PATH = database;
    const composition = createApplicationComposition();
    openCompositions.push(composition);
    const lines: string[] = [];
    const request: ProtocolRequest<'verification.run'> = {
      protocolVersion: PROTOCOL_VERSION,
      id: 'desktop-equivalence',
      method: 'verification.run',
      params: { repository },
    };

    try {
      await handleProtocolRequest(composition.application, request, {
        write: (value) => lines.push(value),
        diagnostic: () => undefined,
      });
      const messages = lines.map((line) => decodeServerMessageLine(line));
      const terminalLine = lines.find((line) => 'result' in decodeServerMessageLine(line));
      const completed = messages.find(
        (message) => 'event' in message && message.event === 'run.completed',
      );
      const persisted = await composition.application.getLatestRun(repository);

      expect(
        messages.some((message) => 'event' in message && message.event === 'check.started'),
      ).toBe(true);
      expect(terminalLine).toBeDefined();
      const decodedTerminal = decodeResultLine('verification.run', terminalLine ?? '');
      if ('error' in decodedTerminal) throw new Error(decodedTerminal.error.message);
      const terminalRun = decodedTerminal.result;
      const eventRun = completed && 'event' in completed ? completed.data.run : undefined;
      expect(terminalRun).toStrictEqual(eventRun);
      expect(terminalRun).toStrictEqual(persisted);
    } finally {
      composition.close();
      openCompositions.splice(openCompositions.indexOf(composition), 1);
      if (previousDatabase === undefined) delete process.env.VERIFY_DATABASE_PATH;
      else process.env.VERIFY_DATABASE_PATH = previousDatabase;
    }
  });
});
