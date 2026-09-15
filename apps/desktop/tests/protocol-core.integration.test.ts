import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProtocolResultMap } from '@verify/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { ProtocolEngineClient, type EngineTransport } from '../src/engine/index.js';

const fixturesRoot = resolve(import.meta.dirname, '../../../fixtures');
const cliSourceEntry = resolve(import.meta.dirname, '../../cli/src/index.ts');
const tsxCliEntry = fileURLToPath(import.meta.resolve('tsx/cli'));
const temporaryDirectories: string[] = [];

interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function git(repository: string, ...args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd: repository,
      stdio: ['ignore', 'ignore', 'pipe'],
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

async function createFixture(
  fixture = 'basic-pass',
): Promise<{ repository: string; database: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'verify-desktop-core-'));
  temporaryDirectories.push(directory);
  const repository = join(directory, 'repository');
  await cp(join(fixturesRoot, fixture), repository, { recursive: true });
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

function spawnCli(
  args: readonly string[],
  database: string,
  stdin?: string,
  onStdout?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [tsxCliEntry, cliSourceEntry, ...args], {
      cwd: resolve(import.meta.dirname, '../../..'),
      env: { ...process.env, VERIFY_DATABASE_PATH: database },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const abort = () => child.kill();

    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function protocolTransport(database: string): EngineTransport {
  return {
    request: async (requestLine, onChunk, signal) => {
      const result = await spawnCli(['protocol'], database, requestLine, onChunk, signal);
      if (result.code !== 0) {
        throw new Error(`Protocol engine exited ${result.code}: ${result.stderr}`);
      }
    },
  };
}

type VerificationRun = ProtocolResultMap['verification.run'];
type ProjectProfileResult = ProtocolResultMap['project.profile'];
type VerificationPlanResult = ProtocolResultMap['verification.plan'];

function deterministicOutcome(run: VerificationRun) {
  return {
    repositoryRoot: run.repositoryRoot,
    status: run.status,
    checks: run.checks.map((check) => ({
      id: check.id,
      name: check.name,
      type: check.type,
      command: check.command,
      failurePolicy: check.failurePolicy,
      status: check.status,
      exitCode: check.exitCode,
      stdout: check.stdout,
      stderr: check.stderr,
      errorSummary: check.errorSummary,
    })),
    gate:
      run.gate === undefined
        ? undefined
        : {
            status: run.gate.status,
            reasons: run.gate.reasons,
            summary: run.gate.summary,
          },
  };
}

function deterministicProfile(result: ProjectProfileResult) {
  if (result.status === 'cancelled') return result;
  return {
    ...result,
    profile: {
      ...result.profile,
      generatedAt: '<generated>',
      scan: { ...result.profile.scan, elapsedMs: 0 },
    },
  };
}

function deterministicPlanPreview(result: VerificationPlanResult) {
  if (result.status === 'cancelled') return result;
  return {
    ...result,
    preview: {
      ...result.preview,
      profile: {
        ...result.preview.profile,
        generatedAt: '<generated>',
        scan: { ...result.preview.profile.scan, elapsedMs: 0 },
      },
      plans: {
        quick: { ...result.preview.plans.quick, profileGeneratedAt: '<generated>' },
        full: { ...result.preview.plans.full, profileGeneratedAt: '<generated>' },
      },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('desktop/core equivalence', () => {
  it('returns the same deterministic outcome through the GUI client and CLI JSON paths', async () => {
    const { repository, database } = await createFixture();
    const client = new ProtocolEngineClient(protocolTransport(database), {
      createRequestId: () => 'desktop-core-equivalence',
    });

    const guiRun = await client.request('verification.run', { repository });
    const cliResult = await spawnCli(['run', repository, '--json'], database);

    expect(cliResult.code).toBe(0);
    expect(cliResult.stderr).toBe('');
    expect(cliResult.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    const cliRun = JSON.parse(cliResult.stdout) as VerificationRun;
    expect(deterministicOutcome(guiRun)).toStrictEqual(deterministicOutcome(cliRun));
  }, 20_000);

  it.each([
    ['Node/Vite/Vitest', 'project-intelligence/node-vite-vitest'],
    ['Node/Jest', 'project-intelligence/node-jest'],
    ['plain static site', 'project-intelligence/plain-static'],
    ['Python/pytest', 'project-intelligence/python-pytest'],
    ['npm workspace', 'project-intelligence/workspace-npm'],
    ['pnpm workspace', 'project-intelligence/workspace-pnpm'],
    ['Yarn workspace', 'project-intelligence/workspace-yarn'],
    ['mixed Node/Python', 'project-intelligence/mixed-node-python'],
    ['ambiguous workspace', 'project-intelligence/workspace-ambiguous'],
  ])(
    'returns the same read-only %s project profile through GUI protocol and CLI JSON paths',
    async (_profileKind, fixture) => {
      const { repository, database } = await createFixture(fixture);
      const client = new ProtocolEngineClient(protocolTransport(database), {
        createRequestId: () => 'desktop-profile-equivalence',
      });

      const guiResult = await client.request('project.profile', { repository });
      const cliResult = await spawnCli(['understand', repository, '--json'], database);

      expect(cliResult.code).toBe(0);
      expect(cliResult.stderr).toBe('');
      expect(cliResult.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
      const cliProfile = JSON.parse(cliResult.stdout) as ProjectProfileResult;
      expect(deterministicProfile(guiResult)).toStrictEqual(deterministicProfile(cliProfile));
      await expect(access(database)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    20_000,
  );

  it('returns the same read-only plan preview through GUI protocol and CLI JSON paths', async () => {
    const { repository, database } = await createFixture('project-intelligence/node-vite-vitest');
    const client = new ProtocolEngineClient(protocolTransport(database), {
      createRequestId: () => 'desktop-plan-equivalence',
    });

    const guiResult = await client.request('verification.plan', { repository });
    const cliResult = await spawnCli(['plan', repository, '--json'], database);

    expect(cliResult.code).toBe(0);
    expect(cliResult.stderr).toBe('');
    expect(cliResult.stdout.trim().split(/\r?\n/u)).toHaveLength(1);
    const cliPreview = JSON.parse(cliResult.stdout) as VerificationPlanResult;
    expect(deterministicPlanPreview(guiResult)).toStrictEqual(deterministicPlanPreview(cliPreview));
    await expect(access(database)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);
});
