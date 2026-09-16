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
  readonly profileLatencyMs?: number;
  readonly verificationCheckLatencyMs?: number;
  readonly verificationCancellationBarrier?: Promise<void>;
  readonly failMethod?: ProtocolMethod;
  readonly profileCompleteness?: 'complete' | 'partial';
  readonly profileAmbiguous?: boolean;
  readonly rejectProfileCancellation?: boolean;
  readonly initialPolicyVersion?: 1 | 2;
  readonly migrationStale?: boolean;
  readonly migrationLatencyMs?: number;
  readonly migrationPreviewBarrier?: Promise<void>;
  readonly initialApprovalStatus?: 'not-approved' | 'approved' | 'outdated' | 'revoked';
  readonly approvalStale?: boolean;
  readonly approvalStatusBarrier?: Promise<void>;
  readonly approvalReviewTestCommand?: string;
}

type VerificationRun = ProtocolResultMap['verification.run'];
type CheckResult = VerificationRun['checks'][number];
type ProjectConfig = NonNullable<ProtocolResultMap['config.get']['config']>;
type ProjectConfigV2 = Extract<
  NonNullable<ProtocolResultMap['config.policy.get']['config']>,
  { version: 2 }
>;
type ProjectProfile = Extract<
  ProtocolResultMap['project.profile'],
  { status: 'completed' }
>['profile'];
type VerificationPlanPreview = Extract<
  ProtocolResultMap['verification.plan'],
  { status: 'completed' }
>['preview'];

const BASE_TIME = Date.parse('2026-09-07T14:20:00.000Z');

function iso(offsetMs: number): string {
  return new Date(BASE_TIME + offsetMs).toISOString();
}

function projectName(repository: string): string {
  const parts = repository.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? 'local-project';
}

function projectProfile(
  repository: string,
  completeness: ProjectProfile['completeness'],
  ambiguous: boolean,
): ProjectProfile {
  const name = projectName(repository);
  const evidence = [
    {
      id: 'node:manifest',
      sensorId: 'node',
      kind: 'manifest' as const,
      path: 'package.json',
      summary: 'package.json declares a Node project.',
    },
    {
      id: 'node:package-manager',
      sensorId: 'node',
      kind: 'manifest' as const,
      path: 'package.json',
      pointer: ['packageManager'],
      summary: 'packageManager declares pnpm.',
    },
    {
      id: 'node:vite',
      sensorId: 'node',
      kind: 'config' as const,
      path: 'vite.config.ts',
      summary: 'A Vite configuration file is present.',
    },
    {
      id: 'node:typescript',
      sensorId: 'node',
      kind: 'config' as const,
      path: 'tsconfig.json',
      summary: 'A TypeScript configuration file is present.',
    },
    {
      id: 'node:vitest',
      sensorId: 'node',
      kind: 'config' as const,
      path: 'vitest.config.ts',
      summary: 'A Vitest configuration file is present.',
    },
    {
      id: 'node:eslint',
      sensorId: 'node',
      kind: 'config' as const,
      path: 'eslint.config.js',
      summary: 'An ESLint configuration file is present.',
    },
    {
      id: 'node:test-path',
      sensorId: 'node',
      kind: 'path' as const,
      path: 'tests/main.test.ts',
      summary: 'A conventional Vitest test file is present.',
    },
    ...['test', 'build', 'lint', 'typecheck'].map((script) => ({
      id: `node:script:${script}`,
      sensorId: 'node',
      kind: 'script' as const,
      path: 'package.json',
      pointer: ['scripts', script],
      summary: `package.json declares the ${script} script.`,
    })),
    ...(ambiguous
      ? [
          {
            id: 'node:npm-lock',
            sensorId: 'node',
            kind: 'lockfile' as const,
            path: 'package-lock.json',
            summary: 'An npm lockfile is also present.',
          },
        ]
      : []),
  ];

  return {
    profileVersion: 1,
    repositoryRoot: repository,
    displayName: name,
    generatedAt: iso(0),
    completeness,
    scan: {
      entriesScanned: 18,
      filesScanned: 13,
      directoriesScanned: 5,
      bytesRead: 2_048,
      skippedDirectories: 2,
      elapsedMs: 24,
      limitsReached: completeness === 'partial' ? ['entries'] : [],
    },
    capabilities: [
      {
        id: 'runtime.node',
        kind: 'runtime',
        name: 'Node.js',
        confidence: 'confirmed',
        evidenceIds: ['node:manifest'],
      },
      {
        id: 'language.typescript',
        kind: 'language',
        name: 'TypeScript',
        confidence: 'confirmed',
        evidenceIds: ['node:typescript'],
      },
      {
        id: 'package-manager.pnpm',
        kind: 'package-manager',
        name: 'pnpm',
        confidence: 'confirmed',
        evidenceIds: ['node:package-manager'],
      },
      {
        id: 'framework.vite',
        kind: 'framework',
        name: 'Vite',
        confidence: 'confirmed',
        evidenceIds: ['node:vite'],
      },
      {
        id: 'build-tool.vite',
        kind: 'build-tool',
        name: 'Vite',
        confidence: 'confirmed',
        evidenceIds: ['node:vite'],
      },
      {
        id: 'test-framework.vitest',
        kind: 'test-framework',
        name: 'Vitest',
        confidence: 'confirmed',
        evidenceIds: ['node:vitest', 'node:test-path'],
      },
      {
        id: 'linter.eslint',
        kind: 'linter',
        name: 'ESLint',
        confidence: 'confirmed',
        evidenceIds: ['node:eslint'],
      },
      {
        id: 'typechecker.typescript',
        kind: 'typechecker',
        name: 'TypeScript',
        confidence: 'confirmed',
        evidenceIds: ['node:typescript'],
      },
    ],
    workspaceUnits: [
      {
        id: 'workspace.root',
        path: '.',
        name,
        evidenceIds: ['node:manifest'],
      },
    ],
    taskCandidates: (
      [
        ['test', 'Run test (test)', 'vitest run'],
        ['build', 'Run build (build)', 'vite build'],
        ['lint', 'Run lint (lint)', 'eslint .'],
        ['typecheck', 'Run typecheck (typecheck)', 'tsc --noEmit'],
      ] as const
    ).map(([kind, label, command]) => ({
      id: `task.root.${kind}`,
      kind,
      label,
      command,
      workingDirectory: '.',
      workspaceId: 'workspace.root',
      confidence: 'confirmed' as const,
      evidenceIds: [`node:script:${kind}`],
    })),
    evidence,
    ambiguities: ambiguous
      ? [
          {
            code: 'package-manager-conflict',
            message: 'Both pnpm and npm package-manager evidence is present.',
            candidateIds: ['package-manager.pnpm'],
            evidenceIds: ['node:package-manager', 'node:npm-lock'],
          },
        ]
      : [],
    warnings:
      completeness === 'partial'
        ? [
            {
              code: 'scan-entry-limit',
              message: 'The entry limit was reached; this profile has partial coverage.',
              affectsCompleteness: true,
            },
          ]
        : [],
  };
}

function verificationPlanPreview(profile: ProjectProfile): VerificationPlanPreview {
  const capabilityByKind = {
    test: 'test-framework.vitest',
    lint: 'linter.eslint',
    typecheck: 'typechecker.typescript',
    build: 'build-tool.vite',
  } as const;
  const candidates = profile.taskCandidates.filter(
    (candidate) => candidate.kind in capabilityByKind,
  );
  const supported = profile.completeness === 'complete' && profile.ambiguities.length === 0;
  const createDecision = (
    candidate: (typeof candidates)[number],
    mode: 'quick' | 'full',
    selected: boolean,
  ) => ({
    taskCandidateId: candidate.id,
    kind: candidate.kind as keyof typeof capabilityByKind,
    label: candidate.label,
    command: candidate.command,
    workingDirectory: candidate.workingDirectory,
    ...(candidate.workspaceId === undefined ? {} : { workspaceId: candidate.workspaceId }),
    confidence: candidate.confidence,
    capabilityIds: [capabilityByKind[candidate.kind as keyof typeof capabilityByKind]],
    evidenceIds: candidate.evidenceIds,
    reason: selected
      ? `Selected for the ${mode} plan because the profile contains one confirmed root ${candidate.kind} task with matching deterministic capability evidence.`
      : supported
        ? `Skipped in Quick mode; the ${candidate.kind} task is reserved for the Full plan.`
        : 'Skipped because slice 6A requires a complete, unambiguous, single-root Node/Vite/Vitest profile.',
  });
  const createPlanFields = (mode: 'quick' | 'full') => {
    const selectedKinds = mode === 'quick' ? new Set(['test', 'lint']) : undefined;
    const selected = candidates.filter(
      (candidate) =>
        supported && (selectedKinds === undefined || selectedKinds.has(candidate.kind)),
    );
    const skipped = candidates.filter(
      (candidate) =>
        !supported || (selectedKinds !== undefined && !selectedKinds.has(candidate.kind)),
    );

    return {
      planVersion: 1 as const,
      status: supported ? ('ready' as const) : ('unavailable' as const),
      statusReason: supported
        ? `${selected.length} evidence-backed checks selected for the ${mode} preview.`
        : 'No checks were selected because slice 6A requires a complete, unambiguous, single-root Node/Vite/Vitest profile.',
      repositoryRoot: profile.repositoryRoot,
      profileVersion: profile.profileVersion,
      profileGeneratedAt: profile.generatedAt,
      profileCompleteness: profile.completeness,
      recommendationSource: 'deterministic-project-profile' as const,
      selectedChecks: selected.map((candidate) => createDecision(candidate, mode, true)),
      skippedChecks: skipped.map((candidate) => createDecision(candidate, mode, false)),
    };
  };

  return {
    profile,
    plans: {
      quick: { ...createPlanFields('quick'), mode: 'quick' },
      full: { ...createPlanFields('full'), mode: 'full' },
    },
  };
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

function configV2For(repository: string): ProjectConfigV2 {
  return {
    ...configFor(repository),
    version: 2,
    plans: {
      quick: { suites: ['test', 'lint'] },
      full: { suites: ['test', 'typecheck', 'lint'] },
    },
    launch_targets: {},
    discovery: { exclusions: [] },
    overrides: {},
  };
}

const MOCK_SOURCE_DIGEST = 'a'.repeat(64);
const MOCK_TARGET_DIGEST = 'b'.repeat(64);
const MOCK_EXECUTABLE_DIGEST = 'c'.repeat(64);
const MOCK_OUTDATED_DIGEST = 'd'.repeat(64);
const MOCK_TARGET_YAML = `version: 2
project:
  name: example
suites: {}
plans:
  quick:
    suites: [test, lint]
  full:
    suites: [test, typecheck, lint]
launch_targets: {}
discovery:
  exclusions: []
overrides: {}
`;
const MOCK_MIGRATION_DIFF = `--- .verify/project.yml (version 1)
+++ .verify/project.yml (version 2)
@@ -1,1 +1,1 @@
-version: 1
+version: 2
+plans:
+  quick:
+    suites: [test, lint]
+  full:
+    suites: [test, typecheck, lint]
`;

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

function cancelledVerificationRun(
  repository: string,
  checks: readonly CheckResult[],
): VerificationRun {
  const startedAt = iso(1_000);
  const completedAt = new Date().toISOString();
  const cancelled = checks.filter((check) => check.status === 'cancelled').length;
  return {
    id: 'mock-cancelled-005',
    repositoryRoot: repository,
    status: 'cancelled',
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    checks,
    gate: {
      status: 'BLOCK',
      reasons:
        cancelled === 0
          ? ['No verification checks were run.']
          : [`${checks.at(-1)?.name ?? 'A configured check'} was cancelled.`],
      evaluatedAt: completedAt,
      summary: {
        total: checks.length,
        passed: checks.filter((check) => check.status === 'passed').length,
        warning: checks.filter((check) => check.status === 'warning').length,
        failed: checks.filter((check) => check.status === 'failed').length,
        error: checks.filter((check) => check.status === 'error').length,
        cancelled,
        skipped: checks.filter((check) => check.status === 'skipped').length,
      },
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
  readonly #profileLatencyMs: number;
  readonly #verificationCheckLatencyMs: number;
  readonly #verificationCancellationBarrier?: Promise<void>;
  readonly #failMethod?: ProtocolMethod;
  readonly #profileCompleteness: ProjectProfile['completeness'];
  readonly #profileAmbiguous: boolean;
  readonly #rejectProfileCancellation: boolean;
  readonly #migrationStale: boolean;
  readonly #migrationLatencyMs: number;
  readonly #migrationPreviewBarrier?: Promise<void>;
  readonly #initialApprovalStatus: NonNullable<MockEngineClientOptions['initialApprovalStatus']>;
  readonly #approvalStale: boolean;
  readonly #approvalReviewTestCommand?: string;
  #approvalStatusBarrier?: Promise<void>;
  readonly #approvalByRepository = new Map<
    string,
    NonNullable<ProtocolResultMap['config.approval.status']['receipt']>
  >();
  #configExists: boolean;
  #policyVersion: 1 | 2;

  public constructor(options: MockEngineClientOptions = {}) {
    this.#scenario = options.gateScenario ?? 'PASS';
    this.#configExists = options.configExists ?? true;
    this.#latencyMs = options.latencyMs ?? 40;
    this.#profileLatencyMs = options.profileLatencyMs ?? this.#latencyMs;
    this.#verificationCheckLatencyMs = options.verificationCheckLatencyMs ?? this.#latencyMs;
    this.#verificationCancellationBarrier = options.verificationCancellationBarrier;
    this.#failMethod = options.failMethod;
    this.#profileCompleteness = options.profileCompleteness ?? 'complete';
    this.#profileAmbiguous = options.profileAmbiguous ?? false;
    this.#rejectProfileCancellation = options.rejectProfileCancellation ?? false;
    this.#migrationStale = options.migrationStale ?? false;
    this.#migrationLatencyMs = options.migrationLatencyMs ?? this.#latencyMs;
    this.#migrationPreviewBarrier = options.migrationPreviewBarrier;
    this.#initialApprovalStatus = options.initialApprovalStatus ?? 'not-approved';
    this.#approvalStale = options.approvalStale ?? false;
    this.#approvalReviewTestCommand = options.approvalReviewTestCommand;
    this.#approvalStatusBarrier = options.approvalStatusBarrier;
    this.#policyVersion = options.initialPolicyVersion ?? 1;
  }

  #approvalStatus(repository: string): ProtocolResultMap['config.approval.status'] {
    if (this.#policyVersion === 2 && !this.#approvalByRepository.has(repository)) {
      const initial = this.#initialApprovalStatus;
      if (initial !== 'not-approved') {
        this.#approvalByRepository.set(repository, {
          id: `mock-approval-${projectName(repository)}`,
          repositoryRoot: repository,
          policySchemaVersion: 2,
          digestVersion: 1,
          policyDigest: initial === 'outdated' ? MOCK_OUTDATED_DIGEST : MOCK_EXECUTABLE_DIGEST,
          approvedAt: iso(11_000),
          revokedAt: initial === 'revoked' ? iso(12_000) : null,
        });
      }
    }
    const receipt = this.#approvalByRepository.get(repository) ?? null;
    const policyVersion = this.#configExists ? this.#policyVersion : null;
    const policyDigest = policyVersion === 2 ? MOCK_EXECUTABLE_DIGEST : null;
    const status = !this.#configExists
      ? 'policy-missing'
      : policyVersion === 1
        ? 'migration-required'
        : receipt === null
          ? 'not-approved'
          : receipt.revokedAt !== null
            ? 'revoked'
            : receipt.policyDigest !== policyDigest
              ? 'outdated'
              : 'approved';
    return {
      repositoryRoot: repository,
      policyPath: `${repository}/.verify/project.yml`,
      policyExists: this.#configExists,
      policyVersion,
      policyDigest,
      status,
      receipt,
      review:
        policyVersion === 2
          ? {
              digestVersion: 1,
              policySchemaVersion: 2,
              suites: Object.entries(configV2For(repository).suites).map(([id, suite]) => ({
                id,
                type: suite.type,
                command:
                  id === 'test' && this.#approvalReviewTestCommand
                    ? this.#approvalReviewTestCommand
                    : suite.command,
                failurePolicy: suite.failure_policy,
                timeoutMs: suite.timeout_ms ?? null,
              })),
              plans: {
                quick: [...configV2For(repository).plans.quick.suites],
                full: [...configV2For(repository).plans.full.suites],
              },
              launchTargets: {},
              overrides: {},
            }
          : null,
    };
  }

  public async request<Method extends ProtocolMethod>(
    method: Method,
    params: ProtocolParamsMap[Method],
    options: EngineRequestOptions = {},
  ): Promise<ProtocolResultMap[Method]> {
    const approvalStatusBarrier =
      method === 'config.approval.status' ? this.#approvalStatusBarrier : undefined;
    if (method === 'config.approval.status') this.#approvalStatusBarrier = undefined;
    if (method === 'config.migrate.preview' || method === 'config.migrate.apply') {
      await pause(this.#migrationLatencyMs, options.signal);
    } else if (
      method !== 'project.profile' &&
      method !== 'verification.plan' &&
      method !== 'verification.run'
    ) {
      await pause(this.#latencyMs, options.signal);
    }

    if (this.#failMethod === method) {
      throw new EngineRequestError('MOCK_ERROR', `Mock failure while calling ${method}.`);
    }

    if (method === 'verification.cancel' || method === 'operation.cancel') {
      return { accepted: false } as ProtocolResultMap[Method];
    }

    if (!('repository' in params)) {
      throw new EngineRequestError('MOCK_ERROR', `Unsupported mock method ${method}.`);
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

      case 'project.profile': {
        const progress = [
          {
            phase: 'inventory' as const,
            message: 'Scanning repository metadata.',
            entriesScanned: 9,
            bytesRead: 0,
            sensorsCompleted: 0,
            sensorCount: 1,
          },
          {
            phase: 'sensors' as const,
            message: 'Inspecting Node project evidence.',
            entriesScanned: 18,
            bytesRead: 2_048,
            sensorsCompleted: 0,
            sensorCount: 1,
          },
          {
            phase: 'finalizing' as const,
            message: 'Finalizing the deterministic project profile.',
            entriesScanned: 18,
            bytesRead: 2_048,
            sensorsCompleted: 1,
            sensorCount: 1,
          },
        ];

        for (const data of progress) {
          if (options.signal?.aborted) {
            return { status: 'cancelled' } as ProtocolResultMap[Method];
          }
          options.onEvent?.({
            protocolVersion: 1,
            id: 'mock-profile-event',
            event: 'profile.progress',
            data,
          });
          try {
            await pause(this.#profileLatencyMs, options.signal);
          } catch (error) {
            if (error instanceof EngineRequestError && error.code === 'INTERRUPTED') {
              if (this.#rejectProfileCancellation) throw error;
              return { status: 'cancelled' } as ProtocolResultMap[Method];
            }
            throw error;
          }
        }

        return {
          status: 'completed',
          profile: projectProfile(repository, this.#profileCompleteness, this.#profileAmbiguous),
        } as ProtocolResultMap[Method];
      }

      case 'verification.plan': {
        const progress = [
          {
            phase: 'inventory' as const,
            message: 'Scanning repository metadata.',
            entriesScanned: 9,
            bytesRead: 0,
            sensorsCompleted: 0,
            sensorCount: 1,
          },
          {
            phase: 'sensors' as const,
            message: 'Inspecting Node project evidence.',
            entriesScanned: 18,
            bytesRead: 2_048,
            sensorsCompleted: 0,
            sensorCount: 1,
          },
          {
            phase: 'finalizing' as const,
            message: 'Finalizing the deterministic project profile.',
            entriesScanned: 18,
            bytesRead: 2_048,
            sensorsCompleted: 1,
            sensorCount: 1,
          },
        ];

        for (const data of progress) {
          if (options.signal?.aborted) {
            return { status: 'cancelled' } as ProtocolResultMap[Method];
          }
          options.onEvent?.({
            protocolVersion: 1,
            id: 'mock-plan-event',
            event: 'profile.progress',
            data,
          });
          try {
            await pause(this.#profileLatencyMs, options.signal);
          } catch (error) {
            if (error instanceof EngineRequestError && error.code === 'INTERRUPTED') {
              if (this.#rejectProfileCancellation) throw error;
              return { status: 'cancelled' } as ProtocolResultMap[Method];
            }
            throw error;
          }
        }

        const profile = projectProfile(
          repository,
          this.#profileCompleteness,
          this.#profileAmbiguous,
        );
        return {
          status: 'completed',
          preview: verificationPlanPreview(profile),
        } as ProtocolResultMap[Method];
      }

      case 'config.get':
        if (this.#policyVersion === 2) {
          throw new EngineRequestError('UNSUPPORTED_SCHEMA', 'config.get accepts version 1 only.');
        }
        return {
          exists: this.#configExists,
          path: `${repository}/.verify/project.yml`,
          ...(this.#configExists ? { config: configFor(repository) } : {}),
        } as ProtocolResultMap[Method];

      case 'config.policy.get':
        return {
          repositoryRoot: repository,
          exists: this.#configExists,
          path: `${repository}/.verify/project.yml`,
          ...(this.#configExists
            ? {
                config: this.#policyVersion === 1 ? configFor(repository) : configV2For(repository),
              }
            : {}),
        } as ProtocolResultMap[Method];

      case 'config.migrate.preview':
        await this.#migrationPreviewBarrier;
        if (!this.#configExists || this.#policyVersion !== 1) {
          throw new EngineRequestError(
            'UNSUPPORTED_SCHEMA',
            'Only an existing version 1 policy can be migrated.',
          );
        }
        return {
          path: `${repository}/.verify/project.yml`,
          sourceVersion: 1,
          targetVersion: 2,
          sourceDigest: MOCK_SOURCE_DIGEST,
          targetDigest: MOCK_TARGET_DIGEST,
          targetYaml: MOCK_TARGET_YAML,
          diff: MOCK_MIGRATION_DIFF,
          summary:
            'Preserves named suites and proposes Quick and Full membership without approving commands.',
        } as ProtocolResultMap[Method];

      case 'config.migrate.apply':
        if (
          !this.#configExists ||
          this.#policyVersion !== 1 ||
          this.#migrationStale ||
          !('expectedSourceDigest' in params) ||
          params.expectedSourceDigest !== MOCK_SOURCE_DIGEST ||
          params.expectedTargetDigest !== MOCK_TARGET_DIGEST
        ) {
          throw new EngineRequestError('MIGRATION_STALE', 'The reviewed policy changed.');
        }
        this.#policyVersion = 2;
        return {
          path: `${repository}/.verify/project.yml`,
          version: 2,
          sourceDigest: MOCK_SOURCE_DIGEST,
          targetDigest: MOCK_TARGET_DIGEST,
          config: configV2For(repository),
        } as ProtocolResultMap[Method];

      case 'config.approval.status': {
        await approvalStatusBarrier;
        return this.#approvalStatus(repository) as ProtocolResultMap[Method];
      }

      case 'config.approval.approve': {
        if (
          !this.#configExists ||
          this.#policyVersion !== 2 ||
          this.#approvalStale ||
          !('expectedPolicyDigest' in params) ||
          params.expectedPolicyDigest !== MOCK_EXECUTABLE_DIGEST
        ) {
          throw new EngineRequestError('APPROVAL_STALE', 'The reviewed executable policy changed.');
        }
        this.#approvalByRepository.set(repository, {
          id: `mock-approval-${projectName(repository)}`,
          repositoryRoot: repository,
          policySchemaVersion: 2,
          digestVersion: 1,
          policyDigest: MOCK_EXECUTABLE_DIGEST,
          approvedAt: iso(13_000),
          revokedAt: null,
        });
        return this.#approvalStatus(repository) as ProtocolResultMap[Method];
      }

      case 'config.approval.revoke': {
        const receipt = this.#approvalByRepository.get(repository);
        if (receipt && receipt.revokedAt === null) {
          this.#approvalByRepository.set(repository, { ...receipt, revokedAt: iso(14_000) });
        }
        return this.#approvalStatus(repository) as ProtocolResultMap[Method];
      }

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
        const completedResults: CheckResult[] = [];
        const finishCancelled = (checks: readonly CheckResult[]): ProtocolResultMap[Method] => {
          const cancelledRun = cancelledVerificationRun(repository, checks);
          options.onEvent?.({
            protocolVersion: 1,
            id: 'mock-event',
            event: 'run.completed',
            data: { run: cancelledRun },
          });
          return cancelledRun as ProtocolResultMap[Method];
        };

        for (const result of run.checks) {
          if (options.signal?.aborted === true) {
            return finishCancelled(completedResults);
          }
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
          try {
            await pause(this.#verificationCheckLatencyMs, options.signal);
          } catch (error) {
            if (!(error instanceof EngineRequestError) || error.code !== 'INTERRUPTED') {
              throw error;
            }
            await this.#verificationCancellationBarrier;
            const completedAt = new Date().toISOString();
            const cancelledResult: CheckResult = {
              ...result,
              status: 'cancelled',
              completedAt,
              durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(result.startedAt)),
              exitCode: undefined,
              stdout: '',
              stderr: '',
              errorSummary: 'Command execution was cancelled.',
            };
            completedResults.push(cancelledResult);
            options.onEvent?.({
              protocolVersion: 1,
              id: 'mock-event',
              event: 'check.completed',
              data: { runId: run.id, result: cancelledResult },
            });
            return finishCancelled(completedResults);
          }

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
          completedResults.push(result);
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

    throw new EngineRequestError('MOCK_ERROR', `Unsupported mock method ${method}.`);
  }
}

export function createMockEngineClient(options?: MockEngineClientOptions): EngineClient {
  return new MockEngineClient(options);
}
