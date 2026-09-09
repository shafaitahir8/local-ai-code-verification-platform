import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type { VerificationRun } from '@verify/domain';
import {
  decodeResultLine,
  decodeServerMessageLine,
  encodeRequest,
  PROTOCOL_VERSION,
  type ProtocolRequest,
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
