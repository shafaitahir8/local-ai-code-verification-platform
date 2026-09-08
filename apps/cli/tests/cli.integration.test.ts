import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import {
  decodeResultLine,
  decodeServerMessageLine,
  encodeRequest,
  PROTOCOL_VERSION,
  type ProtocolRequest,
} from '@verify/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { createApplicationComposition, type ApplicationComposition } from '../src/composition.js';
import { executeCli, type CliIo } from '../src/program.js';
import { handleProtocolRequest } from '../src/protocol-server.js';

const fixturesRoot = resolve(import.meta.dirname, '../../../fixtures');
const builtCliEntry = resolve(import.meta.dirname, '../dist/index.js');
const temporaryDirectories: string[] = [];
const openCompositions: ApplicationComposition[] = [];

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

async function git(repository: string, ...args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd: repository,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
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
  });

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
    expect(JSON.parse(json.stdout)).toMatchObject({
      repositoryRoot: repository,
      status: 'completed',
      gate: { status: 'PASS' },
    });
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

describe('built child-process protocol', () => {
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
