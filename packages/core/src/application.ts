import { randomUUID } from 'node:crypto';

import type {
  ConfigMigrationApplyResult,
  ConfigMigrationPreview,
  InitializeProjectConfigResult,
  ProjectConfigV1,
  ProjectConfigV2,
  ProjectDiscovery,
} from '@verify/config';
import { toVerificationSuites } from '@verify/config';
import type {
  GateResult,
  ProjectProfileProgress,
  ProjectProfileResult,
  RepositoryChange,
  VerificationPlanPreviewResult,
  VerificationRun,
} from '@verify/domain';
import { evaluateQualityGate } from '@verify/policy';
import type { VerificationLifecycleEvent } from '@verify/verification';

import { NoQualityGateError, NoVerificationRunError } from './errors.js';
import { createVerificationPlanPreview } from './planning.js';
import type {
  ConfigurationPort,
  ProjectProfilerPort,
  RepositoryPort,
  RunRepositoryPort,
  VerificationExecutorPort,
} from './ports.js';

export interface VerifierApplicationDependencies {
  readonly configuration: ConfigurationPort;
  readonly repository: RepositoryPort;
  readonly profiler: ProjectProfilerPort;
  readonly verification: VerificationExecutorPort;
  readonly runs: RunRepositoryPort;
  readonly createRunId?: () => string;
  readonly now?: () => Date;
}

export interface ConfigurationState {
  readonly repositoryRoot: string;
  readonly path: string;
  readonly exists: boolean;
  readonly config?: ProjectConfigV1;
}

export interface ProjectPolicyState {
  readonly repositoryRoot: string;
  readonly path: string;
  readonly exists: boolean;
  readonly config?: ProjectConfigV1 | ProjectConfigV2;
}

export interface ApplyProjectConfigMigrationRequest {
  readonly repository: string;
  readonly expectedSourceDigest: string;
  readonly expectedTargetDigest: string;
}

export interface InitializeProjectRequest {
  readonly repository: string;
  readonly config?: ProjectConfigV1;
  readonly force?: boolean;
}

export interface RunVerificationRequest {
  readonly repository: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: VerificationLifecycleEvent, runId: string) => void;
}

export interface ProfileProjectRequest {
  readonly repository: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ProjectProfileProgress) => void;
}

export type PreviewVerificationPlansRequest = ProfileProjectRequest;

export class VerifierApplication {
  readonly #configuration: ConfigurationPort;
  readonly #repository: RepositoryPort;
  readonly #profiler: ProjectProfilerPort;
  readonly #verification: VerificationExecutorPort;
  readonly #runs: RunRepositoryPort;
  readonly #createRunId: () => string;
  readonly #now: () => Date;

  public constructor(dependencies: VerifierApplicationDependencies) {
    this.#configuration = dependencies.configuration;
    this.#repository = dependencies.repository;
    this.#profiler = dependencies.profiler;
    this.#verification = dependencies.verification;
    this.#runs = dependencies.runs;
    this.#createRunId = dependencies.createRunId ?? randomUUID;
    this.#now = dependencies.now ?? (() => new Date());
  }

  public async discover(repository: string): Promise<ProjectDiscovery> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    return this.#configuration.discover(repositoryRoot);
  }

  public async profileProject(request: ProfileProjectRequest): Promise<ProjectProfileResult> {
    const repositoryRoot = await this.#repository.resolveRoot(request.repository);
    return this.#profiler.profile({
      repositoryRoot,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
    });
  }

  public async previewVerificationPlans(
    request: PreviewVerificationPlansRequest,
  ): Promise<VerificationPlanPreviewResult> {
    const result = await this.profileProject(request);
    return result.status === 'cancelled'
      ? result
      : { status: 'completed', preview: createVerificationPlanPreview(result.profile) };
  }

  public async getConfiguration(repository: string): Promise<ConfigurationState> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    const exists = await this.#configuration.exists(repositoryRoot);
    return {
      repositoryRoot,
      path: this.#configuration.path(repositoryRoot),
      exists,
      ...(exists ? { config: await this.#configuration.load(repositoryRoot) } : {}),
    };
  }

  public async getProjectPolicy(repository: string): Promise<ProjectPolicyState> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    const exists = await this.#configuration.exists(repositoryRoot);
    return {
      repositoryRoot,
      path: this.#configuration.path(repositoryRoot),
      exists,
      ...(exists ? { config: await this.#configuration.loadPolicy(repositoryRoot) } : {}),
    };
  }

  public async previewProjectConfigMigration(repository: string): Promise<ConfigMigrationPreview> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    return this.#configuration.migrationPreview(repositoryRoot);
  }

  public async applyProjectConfigMigration(
    request: ApplyProjectConfigMigrationRequest,
  ): Promise<ConfigMigrationApplyResult> {
    const repositoryRoot = await this.#repository.resolveRoot(request.repository);
    return this.#configuration.migrationApply({
      repositoryRoot,
      expectedSourceDigest: request.expectedSourceDigest,
      expectedTargetDigest: request.expectedTargetDigest,
    });
  }

  public async initializeProject(
    request: InitializeProjectRequest,
  ): Promise<InitializeProjectConfigResult> {
    const repositoryRoot = await this.#repository.resolveRoot(request.repository);
    let config = request.config;
    if (config === undefined) {
      config = (await this.#configuration.preview(repositoryRoot)).suggestedConfig;
    }
    return this.#configuration.initialize({
      repositoryRoot,
      config,
      force: request.force,
    });
  }

  public inspectRepository(repository: string): Promise<RepositoryChange> {
    return this.#repository.inspect(repository);
  }

  public async runVerification(request: RunVerificationRequest): Promise<VerificationRun> {
    const repositoryRoot = await this.#repository.resolveRoot(request.repository);
    const config = await this.#configuration.loadPolicy(repositoryRoot);
    const runId = this.#createRunId();
    const evidence = await this.#verification.run({
      checks: toVerificationSuites(config),
      repositoryRoot,
      environment: request.environment,
      signal: request.signal,
      onEvent:
        request.onEvent === undefined ? undefined : (event) => request.onEvent?.(event, runId),
    });
    const interrupted = evidence.interrupted || request.signal?.aborted === true;
    const gate = evaluateQualityGate(evidence.results, {
      evaluatedAt: this.#now().toISOString(),
      ...(interrupted ? { emptyResultStatus: 'BLOCK' as const, interrupted: true } : {}),
    });
    const run: VerificationRun = {
      id: runId,
      repositoryRoot,
      status: interrupted ? 'cancelled' : 'completed',
      startedAt: evidence.startedAt,
      completedAt: evidence.completedAt,
      durationMs: evidence.durationMs,
      checks: evidence.results,
      gate,
    };

    return this.#runs.saveRun(run);
  }

  public async getLatestRun(repository: string): Promise<VerificationRun> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    const run = await this.#runs.getLatestRun(repositoryRoot);
    if (run === null) throw new NoVerificationRunError(repositoryRoot);
    return run;
  }

  public async evaluateLatestGate(repository: string): Promise<GateResult> {
    const run = await this.getLatestRun(repository);
    if (run.gate === undefined) throw new NoQualityGateError(run.id);
    return run.gate;
  }

  public async getRunHistory(repository: string, limit?: number): Promise<VerificationRun[]> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    return this.#runs.listRuns(repositoryRoot, limit);
  }
}
