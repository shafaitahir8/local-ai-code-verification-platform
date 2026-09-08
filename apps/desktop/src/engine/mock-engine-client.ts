import type {
  ProtocolEventMessage,
  ProtocolMethod,
  ProtocolParamsMap,
  ProtocolResultMap,
} from '@verify/protocol';

import { EngineRequestError, type EngineClient, type EngineRequestOptions } from './contracts.js';

export type MockGateScenario = 'PASS' | 'WARN' | 'BLOCK';

export interface MockEngineClientOptions {
  readonly gateScenario?: MockGateScenario;
  readonly configExists?: boolean;
  readonly latencyMs?: number;
  readonly failMethod?: ProtocolMethod;
}

type VerificationRun = ProtocolResultMap['verification.run'];
type CheckResult = VerificationRun['checks'][number];
type ProjectConfig = NonNullable<ProtocolResultMap['config.get']['config']>;

const BASE_TIME = Date.parse('2026-09-07T14:20:00.000Z');

function iso(offsetMs: number): string {
  return new Date(BASE_TIME + offsetMs).toISOString();
}

function projectName(repository: string): string {
  const parts = repository.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? 'local-project';
}

function configFor(repository: string): ProjectConfig {
  return {
    version: 1,
    project: { name: projectName(repository) },
    suites: {
      test: {
        type: 'test',
        command: 'pnpm test',
        failure_policy: 'block',
        timeout_ms: 120_000,
      },
      typecheck: {
        type: 'typecheck',
        command: 'pnpm typecheck',
        failure_policy: 'block',
        timeout_ms: 120_000,
      },
      lint: {
        type: 'lint',
        command: 'pnpm lint',
        failure_policy: 'warn',
        timeout_ms: 120_000,
      },
    },
  };
}

function checkResults(scenario: MockGateScenario): readonly CheckResult[] {
  const common = [
    {
      id: 'test',
      name: 'Unit tests',
      type: 'test',
      command: 'pnpm test',
      failurePolicy: 'block' as const,
      status: scenario === 'BLOCK' ? ('failed' as const) : ('passed' as const),
      startedAt: iso(1_000),
      completedAt: iso(5_820),
      durationMs: 4_820,
      exitCode: scenario === 'BLOCK' ? 1 : 0,
      stdout: scenario === 'BLOCK' ? '47 tests passed\n1 test failed\n' : '48 tests passed\n',
      stderr: '',
      ...(scenario === 'BLOCK' ? { errorSummary: 'One unit test failed.' } : {}),
      findings:
        scenario === 'BLOCK'
          ? [
              {
                id: 'mock-finding-1',
                source: 'generic-command',
                severity: 'error' as const,
                message: 'Expected session to expire after logout.',
                file: 'tests/session.test.ts',
                line: 84,
              },
            ]
          : [],
      artifacts: [],
    },
    {
      id: 'typecheck',
      name: 'Type check',
      type: 'typecheck',
      command: 'pnpm typecheck',
      failurePolicy: 'block' as const,
      status: 'passed' as const,
      startedAt: iso(5_900),
      completedAt: iso(8_340),
      durationMs: 2_440,
      exitCode: 0,
      stdout: 'TypeScript completed without errors.\n',
      stderr: '',
      findings: [],
      artifacts: [],
    },
    {
      id: 'lint',
      name: 'Lint',
      type: 'lint',
      command: 'pnpm lint',
      failurePolicy: 'warn' as const,
      status: scenario === 'WARN' ? ('warning' as const) : ('passed' as const),
      startedAt: iso(8_400),
      completedAt: iso(10_230),
      durationMs: 1_830,
      exitCode: scenario === 'WARN' ? 1 : 0,
      stdout: scenario === 'WARN' ? '1 warning found.\n' : 'No lint issues found.\n',
      stderr: '',
      findings:
        scenario === 'WARN'
          ? [
              {
                id: 'mock-finding-2',
                source: 'generic-command',
                severity: 'warning' as const,
                message: 'Prefer an explicit return type.',
                file: 'src/session.ts',
                line: 27,
              },
            ]
          : [],
      artifacts: [],
    },
  ];

  return common;
}

const scenarioReasons: Readonly<Record<MockGateScenario, readonly string[]>> = {
  PASS: ['All configured checks passed.'],
  WARN: ['Lint completed with a warn-policy failure.'],
  BLOCK: ['Unit tests failed under a block policy.'],
};

const scenarioSummaries: Readonly<Record<MockGateScenario, VerificationRun['gate'] & object>> = {
  PASS: {
    status: 'PASS',
    reasons: scenarioReasons.PASS,
    evaluatedAt: iso(10_240),
    summary: { total: 3, passed: 3, warning: 0, failed: 0, error: 0, cancelled: 0, skipped: 0 },
  },
  WARN: {
    status: 'WARN',
    reasons: scenarioReasons.WARN,
    evaluatedAt: iso(10_240),
    summary: { total: 3, passed: 2, warning: 1, failed: 0, error: 0, cancelled: 0, skipped: 0 },
  },
  BLOCK: {
    status: 'BLOCK',
    reasons: scenarioReasons.BLOCK,
    evaluatedAt: iso(10_240),
    summary: { total: 3, passed: 2, warning: 0, failed: 1, error: 0, cancelled: 0, skipped: 0 },
  },
};

function verificationRun(
  repository: string,
  scenario: MockGateScenario,
  id = `mock-${scenario.toLowerCase()}-004`,
  timeShiftMs = 0,
): VerificationRun {
  const checks = checkResults(scenario).map((check) => ({
    ...check,
    startedAt: new Date(Date.parse(check.startedAt) + timeShiftMs).toISOString(),
    completedAt: new Date(Date.parse(check.completedAt) + timeShiftMs).toISOString(),
  }));

  return {
    id,
    repositoryRoot: repository,
    status: 'completed',
    startedAt: iso(1_000 + timeShiftMs),
    completedAt: iso(10_240 + timeShiftMs),
    durationMs: 9_240,
    checks,
    gate: {
      ...scenarioSummaries[scenario],
      evaluatedAt: iso(10_240 + timeShiftMs),
    },
  };
}

async function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new EngineRequestError('INTERRUPTED', 'The mock engine request was interrupted.');
  }

  if (milliseconds <= 0) {
    await Promise.resolve();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new EngineRequestError('INTERRUPTED', 'The mock engine request was interrupted.'));
      },
      { once: true },
    );
  });
}

export class MockEngineClient implements EngineClient {
  readonly #scenario: MockGateScenario;
  readonly #latencyMs: number;
  readonly #failMethod?: ProtocolMethod;
  #configExists: boolean;

  public constructor(options: MockEngineClientOptions = {}) {
    this.#scenario = options.gateScenario ?? 'PASS';
    this.#configExists = options.configExists ?? true;
    this.#latencyMs = options.latencyMs ?? 40;
    this.#failMethod = options.failMethod;
  }

  public async request<Method extends ProtocolMethod>(
    method: Method,
    params: ProtocolParamsMap[Method],
    options: EngineRequestOptions = {},
  ): Promise<ProtocolResultMap[Method]> {
    await pause(this.#latencyMs, options.signal);

    if (this.#failMethod === method) {
      throw new EngineRequestError('MOCK_ERROR', `Mock failure while calling ${method}.`);
    }

    const repository = params.repository;

    switch (method) {
      case 'project.discover':
        return {
          repositoryRoot: repository,
          projectName: projectName(repository),
          projectTypes: ['node', 'typescript', 'vite'],
          markers: ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts'],
          node: {
            packageManager: 'pnpm',
            packageName: projectName(repository),
            scripts: {
              test: 'vitest run',
              lint: 'eslint .',
              typecheck: 'tsc --noEmit',
              build: 'vite build',
            },
          },
          python: null,
          suggestedSuites: [
            {
              id: 'test',
              type: 'test',
              command: 'pnpm test',
              failure_policy: 'block',
              reason: 'package.json defines the "test" script.',
            },
            {
              id: 'lint',
              type: 'lint',
              command: 'pnpm lint',
              failure_policy: 'warn',
              reason: 'package.json defines the "lint" script.',
            },
          ],
          warnings: [],
        } as ProtocolResultMap[Method];

      case 'config.get':
        return {
          exists: this.#configExists,
          path: `${repository}/.verify/project.yml`,
          ...(this.#configExists ? { config: configFor(repository) } : {}),
        } as ProtocolResultMap[Method];

      case 'config.init':
        this.#configExists = true;
        return {
          path: `${repository}/.verify/project.yml`,
          config: configFor(repository),
          overwritten: false,
        } as ProtocolResultMap[Method];

      case 'repository.inspect':
        return {
          repositoryRoot: repository,
          branch: 'feature/session-hardening',
          head: {
            kind: 'branch',
            name: 'feature/session-hardening',
            oid: '18a3c0ffee',
          },
          upstream: 'origin/feature/session-hardening',
          ahead: 2,
          behind: 0,
          filesChanged: 4,
          stagedFiles: 2,
          unstagedFiles: 2,
          additions: 92,
          deletions: 31,
          hasUnknownStatistics: false,
          files: [
            {
              path: 'src/session.ts',
              status: 'modified',
              staged: false,
              unstaged: true,
              stagedStatus: 'unmodified',
              unstagedStatus: 'modified',
              statistics: { additions: 38, deletions: 12, binary: false, known: true },
            },
            {
              path: 'src/auth/middleware.ts',
              status: 'modified',
              staged: true,
              unstaged: false,
              stagedStatus: 'modified',
              unstagedStatus: 'unmodified',
              statistics: { additions: 24, deletions: 9, binary: false, known: true },
            },
            {
              path: 'tests/session.test.ts',
              status: 'added',
              staged: false,
              unstaged: true,
              stagedStatus: 'unmodified',
              unstagedStatus: 'added',
              statistics: { additions: 30, deletions: 0, binary: false, known: true },
            },
            {
              path: 'docs/session-policy.md',
              status: 'deleted',
              staged: true,
              unstaged: false,
              stagedStatus: 'deleted',
              unstagedStatus: 'unmodified',
              statistics: { additions: 0, deletions: 10, binary: false, known: true },
            },
          ],
        } as ProtocolResultMap[Method];

      case 'gate.latest': {
        const run = verificationRun(repository, this.#scenario);
        return { runId: run.id, gate: run.gate } as ProtocolResultMap[Method];
      }

      case 'runs.list': {
        const runs = [
          verificationRun(repository, this.#scenario),
          verificationRun(repository, 'WARN', 'mock-warn-003', -3_600_000),
          verificationRun(repository, 'BLOCK', 'mock-block-002', -86_400_000),
        ];
        const limit = 'limit' in params ? (params.limit ?? runs.length) : runs.length;
        return { runs: runs.slice(0, limit) } as ProtocolResultMap[Method];
      }

      case 'verification.run': {
        const run = verificationRun(repository, this.#scenario);

        for (const result of run.checks) {
          const started: ProtocolEventMessage = {
            protocolVersion: 1,
            id: 'mock-event',
            event: 'check.started',
            data: {
              runId: run.id,
              check: {
                id: result.id,
                name: result.name,
                type: result.type,
                command: result.command ?? result.name,
                failurePolicy: result.failurePolicy,
              },
              startedAt: result.startedAt,
            },
          };
          options.onEvent?.(started);
          await pause(this.#latencyMs, options.signal);

          const output: ProtocolEventMessage = {
            protocolVersion: 1,
            id: 'mock-event',
            event: 'check.output',
            data: {
              runId: run.id,
              checkId: result.id,
              stream: 'stdout',
              chunk: result.stdout ?? '',
              timestamp: result.completedAt,
            },
          };
          options.onEvent?.(output);

          const completed: ProtocolEventMessage = {
            protocolVersion: 1,
            id: 'mock-event',
            event: 'check.completed',
            data: { runId: run.id, result },
          };
          options.onEvent?.(completed);
        }

        options.onEvent?.({
          protocolVersion: 1,
          id: 'mock-event',
          event: 'run.completed',
          data: { run },
        });

        return run as ProtocolResultMap[Method];
      }
    }
  }
}

export function createMockEngineClient(options?: MockEngineClientOptions): EngineClient {
  return new MockEngineClient(options);
}
