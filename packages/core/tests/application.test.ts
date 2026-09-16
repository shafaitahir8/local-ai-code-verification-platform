import type {
  ProjectConfigPreview,
  ProjectConfigV1,
  ProjectConfigV2,
  ProjectDiscovery,
} from '@verify/config';
import type { ProjectProfileResult, RepositoryChange, VerificationRun } from '@verify/domain';
import { describe, expect, it, vi } from 'vitest';

import { NoVerificationRunError, VerifierApplication } from '../src/index.js';
import type {
  ConfigurationPort,
  ProjectProfilerPort,
  RepositoryPort,
  RunRepositoryPort,
  VerificationExecutorPort,
} from '../src/index.js';

const root = '/repo';
const config: ProjectConfigV1 = {
  version: 1,
  project: { name: 'example' },
  suites: {
    test: { type: 'test', command: 'npm test', failure_policy: 'block' },
  },
};
const migratedConfig: ProjectConfigV2 = {
  version: 2,
  project: config.project,
  suites: config.suites,
  plans: { quick: { suites: ['test'] }, full: { suites: ['test'] } },
  launch_targets: {},
  discovery: { exclusions: [] },
  overrides: {},
};
const sourceDigest = 'a'.repeat(64);
const targetDigest = 'b'.repeat(64);
const discovery: ProjectDiscovery = {
  repositoryRoot: root,
  projectName: 'example',
  projectTypes: ['node'],
  markers: ['package.json'],
  node: { packageManager: 'npm', packageName: 'example', scripts: { test: 'vitest' } },
  python: null,
  suggestedSuites: [
    {
      id: 'test',
      type: 'test',
      command: 'npm test',
      failure_policy: 'block',
      reason: 'package.json defines test.',
    },
  ],
  warnings: [],
};

function dependencies() {
  const saved: VerificationRun[] = [];
  const configuration: ConfigurationPort = {
    exists: async () => true,
    load: async () => config,
    loadPolicy: async () => config,
    migrationPreview: async () => ({
      path: '/repo/.verify/project.yml',
      sourceVersion: 1,
      targetVersion: 2,
      sourceDigest,
      targetDigest,
      targetYaml: 'version: 2\n',
      diff: '--- a/.verify/project.yml\n+++ b/.verify/project.yml\n',
      summary: 'Retain named suites and propose Quick/Full membership.',
    }),
    migrationApply: async () => ({
      path: '/repo/.verify/project.yml',
      version: 2,
      sourceDigest,
      targetDigest,
      config: migratedConfig,
    }),
    preview: async (): Promise<ProjectConfigPreview> => ({
      path: '/repo/.verify/project.yml',
      exists: false,
      discovery,
      suggestedConfig: config,
    }),
    discover: async () => discovery,
    initialize: async (options) => ({
      path: '/repo/.verify/project.yml',
      config: options.config ?? config,
      overwritten: false,
    }),
    path: () => '/repo/.verify/project.yml',
  };
  const change: RepositoryChange = {
    repositoryRoot: root,
    branch: 'main',
    head: { kind: 'branch', name: 'main' },
    ahead: 0,
    behind: 0,
    filesChanged: 0,
    stagedFiles: 0,
    unstagedFiles: 0,
    additions: 0,
    deletions: 0,
    hasUnknownStatistics: false,
    files: [],
  };
  const repository: RepositoryPort = {
    resolveRoot: async () => root,
    inspect: async () => change,
  };
  const profiler: ProjectProfilerPort = {
    profile: async (): Promise<ProjectProfileResult> => ({ status: 'cancelled' }),
  };
  const verification: VerificationExecutorPort = {
    run: async () => ({
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1_000,
      interrupted: false,
      results: [
        {
          id: 'test',
          name: 'test',
          type: 'test',
          command: 'npm test',
          failurePolicy: 'block',
          status: 'passed',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          durationMs: 1_000,
          exitCode: 0,
          findings: [],
          artifacts: [],
        },
      ],
    }),
  };
  const runs: RunRepositoryPort = {
    saveRun: async (run) => {
      const persisted = { ...run, projectId: 'project-1' };
      saved.unshift(persisted);
      return persisted;
    },
    getLatestRun: async () => saved[0] ?? null,
    listRuns: async (_repositoryRoot, limit = 20) => saved.slice(0, limit),
  };
  return { configuration, repository, profiler, verification, runs, saved };
}

describe('VerifierApplication', () => {
  it('projects policy and migration through the configuration port without executing or persisting', async () => {
    const ports = dependencies();
    const preview = vi.spyOn(ports.configuration, 'migrationPreview');
    const apply = vi.spyOn(ports.configuration, 'migrationApply');
    ports.configuration.loadPolicy = async () => migratedConfig;
    ports.profiler.profile = async () => {
      throw new Error('Migration cannot profile or execute an observed task.');
    };
    ports.verification.run = async () => {
      throw new Error('Migration cannot execute a project command.');
    };
    ports.runs.saveRun = async () => {
      throw new Error('Migration cannot create a verification record.');
    };
    const application = new VerifierApplication(ports);

    expect(await application.getProjectPolicy('/repo/subdirectory')).toEqual({
      repositoryRoot: root,
      path: '/repo/.verify/project.yml',
      exists: true,
      config: migratedConfig,
    });
    expect(await application.previewProjectConfigMigration('/repo/subdirectory')).toMatchObject({
      sourceDigest,
      targetDigest,
    });
    expect(preview).toHaveBeenCalledWith(root);
    expect(
      await application.applyProjectConfigMigration({
        repository: '/repo/subdirectory',
        expectedSourceDigest: sourceDigest,
        expectedTargetDigest: targetDigest,
      }),
    ).toMatchObject({ config: migratedConfig });
    expect(apply).toHaveBeenCalledWith({
      repositoryRoot: root,
      expectedSourceDigest: sourceDigest,
      expectedTargetDigest: targetDigest,
    });
  });

  it('uses unchanged named suites for legacy configured verification after an accepted migration', async () => {
    const ports = dependencies();
    ports.configuration.loadPolicy = async () => migratedConfig;
    ports.configuration.load = async () => {
      throw new Error('A v2 policy must not be passed through strict config.get.');
    };
    const executor = vi.spyOn(ports.verification, 'run');

    const run = await new VerifierApplication(ports).runVerification({ repository: root });

    expect(run.gate?.status).toBe('PASS');
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: [expect.objectContaining({ id: 'test', command: 'npm test', type: 'test' })],
      }),
    );
  });

  it('initializes from a discovered and user-reviewable preview', async () => {
    const ports = dependencies();
    const application = new VerifierApplication(ports);

    const result = await application.initializeProject({ repository: root });

    expect(result.config).toEqual(config);
    expect(result.overwritten).toBe(false);
  });

  it('profiles through its dedicated read-only port without touching other application ports', async () => {
    const ports = dependencies();
    const progress = vi.fn();
    const controller = new AbortController();
    const expected: ProjectProfileResult = { status: 'cancelled' };
    ports.configuration.discover = async () => {
      throw new Error('Configuration must not be read while profiling.');
    };
    ports.verification.run = async () => {
      throw new Error('Verification must not run while profiling.');
    };
    ports.runs.saveRun = async () => {
      throw new Error('Profiling must not persist a verification run.');
    };
    ports.profiler.profile = async (request) => {
      expect(request).toEqual({
        repositoryRoot: root,
        signal: controller.signal,
        onProgress: progress,
      });
      return expected;
    };
    const application = new VerifierApplication(ports);

    await expect(
      application.profileProject({
        repository: '/repo/subdirectory',
        signal: controller.signal,
        onProgress: progress,
      }),
    ).resolves.toBe(expected);
  });

  it('previews both plans through profiling without configuration, execution, or persistence', async () => {
    const ports = dependencies();
    const profileResult: ProjectProfileResult = {
      status: 'completed',
      profile: {
        profileVersion: 1,
        repositoryRoot: root,
        displayName: 'example',
        generatedAt: '2026-09-15T00:00:00.000Z',
        completeness: 'complete',
        scan: {
          entriesScanned: 1,
          filesScanned: 1,
          directoriesScanned: 0,
          bytesRead: 10,
          skippedDirectories: 0,
          elapsedMs: 1,
          limitsReached: [],
        },
        capabilities: [
          {
            id: 'runtime.node',
            kind: 'runtime',
            name: 'Node.js',
            confidence: 'confirmed',
            evidenceIds: ['manifest'],
          },
          {
            id: 'framework.vite',
            kind: 'framework',
            name: 'Vite',
            confidence: 'confirmed',
            evidenceIds: ['manifest'],
          },
          {
            id: 'test-framework.vitest',
            kind: 'test-framework',
            name: 'Vitest',
            confidence: 'confirmed',
            evidenceIds: ['manifest'],
          },
        ],
        workspaceUnits: [{ id: 'workspace.root', path: '.', evidenceIds: ['manifest'] }],
        taskCandidates: [],
        evidence: [
          {
            id: 'manifest',
            sensorId: 'node',
            kind: 'manifest',
            path: 'package.json',
            summary: 'Node package manifest is present.',
          },
        ],
        ambiguities: [],
        warnings: [],
      },
    };
    ports.profiler.profile = async () => profileResult;
    ports.configuration.discover = async () => {
      throw new Error('Planning must not read configuration.');
    };
    ports.configuration.load = async () => {
      throw new Error('Planning must not load configuration.');
    };
    ports.verification.run = async () => {
      throw new Error('Planning must not execute commands.');
    };
    ports.runs.saveRun = async () => {
      throw new Error('Planning must not persist runs.');
    };
    const application = new VerifierApplication(ports);

    const result = await application.previewVerificationPlans({ repository: root });

    expect(result).toMatchObject({
      status: 'completed',
      preview: {
        profile: { repositoryRoot: root },
        plans: {
          quick: { mode: 'quick', status: 'unavailable' },
          full: { mode: 'full', status: 'unavailable' },
        },
      },
    });
    expect(ports.saved).toEqual([]);
  });

  it('returns cancellation without publishing a plan preview', async () => {
    const ports = dependencies();
    ports.profiler.profile = async () => ({ status: 'cancelled' });
    const application = new VerifierApplication(ports);

    await expect(application.previewVerificationPlans({ repository: root })).resolves.toEqual({
      status: 'cancelled',
    });
  });

  it('evaluates and persists exactly the run it returns', async () => {
    const ports = dependencies();
    const application = new VerifierApplication({
      ...ports,
      createRunId: () => 'run-1',
      now: () => new Date('2026-01-01T00:00:02.000Z'),
    });

    const run = await application.runVerification({ repository: root });

    expect(run.id).toBe('run-1');
    expect(run.projectId).toBe('project-1');
    expect(run.gate?.status).toBe('PASS');
    expect(ports.saved).toEqual([run]);
    await expect(application.evaluateLatestGate(root)).resolves.toEqual(run.gate);
  });

  it('uses one history store for all interfaces', async () => {
    const ports = dependencies();
    const application = new VerifierApplication(ports);
    await application.runVerification({ repository: root });

    await expect(application.getRunHistory(root, 1)).resolves.toHaveLength(1);
  });

  it('persists a pre-start interruption as cancelled with a blocking gate', async () => {
    const ports = dependencies();
    const controller = new AbortController();
    controller.abort();
    ports.verification.run = async (request) => ({
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 0,
      interrupted: request.signal?.aborted === true,
      results: [],
    });
    const application = new VerifierApplication({
      ...ports,
      createRunId: () => 'cancelled-run',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const run = await application.runVerification({ repository: root, signal: controller.signal });

    expect(run).toMatchObject({
      id: 'cancelled-run',
      status: 'cancelled',
      checks: [],
      gate: {
        status: 'BLOCK',
        reasons: ['No verification checks were run.'],
        summary: { total: 0, cancelled: 0 },
      },
    });
    expect(ports.saved).toEqual([run]);
    await expect(application.getRunHistory(root)).resolves.toEqual([run]);
  });

  it('persists a late accepted interruption as cancelled and never PASS', async () => {
    const ports = dependencies();
    const controller = new AbortController();
    ports.verification.run = async () => {
      controller.abort();
      return {
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        durationMs: 1_000,
        interrupted: false,
        results: [
          {
            id: 'test',
            name: 'test',
            type: 'test',
            command: 'npm test',
            failurePolicy: 'block',
            status: 'passed',
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: '2026-01-01T00:00:01.000Z',
            durationMs: 1_000,
            exitCode: 0,
            findings: [],
            artifacts: [],
          },
        ],
      };
    };
    const application = new VerifierApplication({
      ...ports,
      createRunId: () => 'late-cancelled-run',
      now: () => new Date('2026-01-01T00:00:02.000Z'),
    });

    const run = await application.runVerification({ repository: root, signal: controller.signal });

    expect(run).toMatchObject({
      id: 'late-cancelled-run',
      status: 'cancelled',
      gate: { status: 'BLOCK', reasons: ['Verification was interrupted.'] },
    });
    expect(ports.saved).toEqual([run]);
  });

  it('reports an absent latest run explicitly', async () => {
    const application = new VerifierApplication(dependencies());
    await expect(application.getLatestRun(root)).rejects.toBeInstanceOf(NoVerificationRunError);
  });
});
