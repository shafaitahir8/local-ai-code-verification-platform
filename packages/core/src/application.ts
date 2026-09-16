import { randomUUID } from 'node:crypto';

import type {
  ConfigMigrationApplyResult,
  ConfigMigrationPreview,
  InitializeProjectConfigResult,
  ProjectConfigV1,
  ProjectConfigV2,
  ProjectDiscovery,
} from '@verify/config';
import {
  ConfigNotFoundError,
  ConfigUnsafePathError,
  ConfigValidationError,
  digestExecutablePolicy,
  reviewExecutablePolicy,
  toVerificationSuites,
} from '@verify/config';
import type {
  PolicyApprovalStatus,
  GateResult,
  ProjectProfileProgress,
  ProjectProfileResult,
  RepositoryChange,
  VerificationPlanPreviewResult,
  VerificationRun,
} from '@verify/domain';
import { evaluateQualityGate } from '@verify/policy';
import type { VerificationLifecycleEvent } from '@verify/verification';

import {
  NoQualityGateError,
  NoVerificationRunError,
  PolicyApprovalStaleError,
  PolicyApprovalUnavailableError,
} from './errors.js';
import { createVerificationPlanPreview } from './planning.js';
import type {
  ApprovalReceiptPort,
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
  readonly approvals: ApprovalReceiptPort;
  readonly createRunId?: () => string;
  readonly createApprovalReceiptId?: () => string;
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

export interface ApproveProjectPolicyRequest {
  readonly repository: string;
  readonly expectedPolicyDigest: string;
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
  readonly #approvals: ApprovalReceiptPort;
  readonly #createRunId: () => string;
  readonly #createApprovalReceiptId: () => string;
  readonly #now: () => Date;

  public constructor(dependencies: VerifierApplicationDependencies) {
    this.#configuration = dependencies.configuration;
    this.#repository = dependencies.repository;
    this.#profiler = dependencies.profiler;
    this.#verification = dependencies.verification;
    this.#runs = dependencies.runs;
    this.#approvals = dependencies.approvals;
    this.#createRunId = dependencies.createRunId ?? randomUUID;
    this.#createApprovalReceiptId = dependencies.createApprovalReceiptId ?? randomUUID;
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

  public async getPolicyApprovalStatus(repository: string): Promise<PolicyApprovalStatus> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    const policyPath = this.#configuration.path(repositoryRoot);
    const policyExists = await this.#configuration.exists(repositoryRoot);
    const receipt = await this.#approvals.getLatestApprovalReceipt(repositoryRoot);
    if (!policyExists) {
      return {
        repositoryRoot,
        policyPath,
        policyExists: false,
        policyVersion: null,
        policyDigest: null,
        review: null,
        status: 'policy-missing',
        receipt,
      };
    }

    let policy: ProjectConfigV1 | ProjectConfigV2;
    try {
      policy = await this.#configuration.loadPolicy(repositoryRoot);
    } catch (error) {
      if (error instanceof ConfigNotFoundError) {
        return {
          repositoryRoot,
          policyPath,
          policyExists: false,
          policyVersion: null,
          policyDigest: null,
          review: null,
          status: 'policy-missing',
          receipt,
        };
      }
      if (!(error instanceof ConfigValidationError || error instanceof ConfigUnsafePathError)) {
        throw error;
      }
      return {
        repositoryRoot,
        policyPath,
        policyExists: true,
        policyVersion: null,
        policyDigest: null,
        review: null,
        status: 'policy-invalid',
        receipt,
      };
    }
    if (policy.version === 1) {
      return {
        repositoryRoot,
        policyPath,
        policyExists: true,
        policyVersion: 1,
        policyDigest: null,
        review: null,
        status: 'migration-required',
        receipt,
      };
    }

    const policyDigest = digestExecutablePolicy(policy);
    const review = reviewExecutablePolicy(policy);
    return {
      repositoryRoot,
      policyPath,
      policyExists: true,
      policyVersion: 2,
      policyDigest,
      review,
      status:
        receipt === null
          ? 'not-approved'
          : receipt.revokedAt !== null
            ? 'revoked'
            : receipt.policyDigest === policyDigest &&
                receipt.policySchemaVersion === 2 &&
                receipt.digestVersion === 1 &&
                receipt.repositoryRoot === repositoryRoot
              ? 'approved'
              : 'outdated',
      receipt,
    };
  }

  public async approveProjectPolicy(
    request: ApproveProjectPolicyRequest,
  ): Promise<PolicyApprovalStatus> {
    const current = await this.getPolicyApprovalStatus(request.repository);
    if (
      current.status === 'policy-missing' ||
      current.status === 'policy-invalid' ||
      current.status === 'migration-required'
    ) {
      throw new PolicyApprovalUnavailableError(current.status);
    }
    if (request.expectedPolicyDigest !== current.policyDigest) {
      throw new PolicyApprovalStaleError();
    }

    // Read the durable document again immediately before recording local approval. Status will
    // compare against a fresh read afterward, so a concurrent edit can never return approved.
    const durable = await this.#configuration.loadPolicy(current.repositoryRoot);
    if (durable.version !== 2 || digestExecutablePolicy(durable) !== current.policyDigest) {
      throw new PolicyApprovalStaleError();
    }
    if (current.status !== 'approved') {
      await this.#approvals.approvePolicyReceipt({
        id: this.#createApprovalReceiptId(),
        repositoryRoot: current.repositoryRoot,
        policySchemaVersion: 2,
        digestVersion: 1,
        policyDigest: current.policyDigest,
        approvedAt: this.#now().toISOString(),
        revokedAt: null,
      });
    }
    return this.getPolicyApprovalStatus(current.repositoryRoot);
  }

  public async revokeProjectPolicyApproval(repository: string): Promise<PolicyApprovalStatus> {
    const repositoryRoot = await this.#repository.resolveRoot(repository);
    await this.#approvals.revokeActiveApprovalReceipt(repositoryRoot, this.#now().toISOString());
    return this.getPolicyApprovalStatus(repositoryRoot);
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
