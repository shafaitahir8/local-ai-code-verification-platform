import {
  discoverProject,
  applyProjectConfigMigration,
  getProjectConfigPath,
  initializeProjectConfig,
  loadProjectConfig,
  loadProjectPolicy,
  previewProjectConfig,
  previewProjectConfigMigration,
  projectConfigExists,
} from '@verify/config';
import {
  VerifierApplication,
  type ApprovalReceiptPort,
  type ProjectProfilerPort,
  type RunRepositoryPort,
} from '@verify/core';
import { GenericCommandAdapter } from '@verify/adapter-generic-command';
import { createProjectProfiler } from '@verify/project-intelligence';
import { GitRepositoryService } from '@verify/repository';
import { createSqliteRunRepository } from '@verify/storage';
import { VerificationRunner } from '@verify/verification';
import type { SqliteNativeBinding, SqliteRunRepository } from '@verify/storage';

export interface ApplicationComposition {
  readonly application: VerifierApplication;
  close(): void;
}

export interface ApplicationCompositionOptions {
  /** Preloaded better-sqlite3 addon supplied by the self-contained executable bootstrap. */
  readonly sqliteNativeBinding?: SqliteNativeBinding;
  /** Deterministic project profiler override used by contract tests. */
  readonly profiler?: ProjectProfilerPort;
}

class LazyRunRepository implements RunRepositoryPort, ApprovalReceiptPort {
  #repository: SqliteRunRepository | undefined;

  public constructor(private readonly createRepository: () => SqliteRunRepository) {}

  public saveRun(...args: Parameters<RunRepositoryPort['saveRun']>) {
    return this.#get().saveRun(...args);
  }

  public getLatestRun(...args: Parameters<RunRepositoryPort['getLatestRun']>) {
    return this.#get().getLatestRun(...args);
  }

  public listRuns(...args: Parameters<RunRepositoryPort['listRuns']>) {
    return this.#get().listRuns(...args);
  }

  public getLatestApprovalReceipt(
    ...args: Parameters<ApprovalReceiptPort['getLatestApprovalReceipt']>
  ) {
    return this.#get().getLatestApprovalReceipt(...args);
  }

  public approvePolicyReceipt(...args: Parameters<ApprovalReceiptPort['approvePolicyReceipt']>) {
    return this.#get().approvePolicyReceipt(...args);
  }

  public revokeActiveApprovalReceipt(
    ...args: Parameters<ApprovalReceiptPort['revokeActiveApprovalReceipt']>
  ) {
    return this.#get().revokeActiveApprovalReceipt(...args);
  }

  public close(): void {
    this.#repository?.close();
  }

  #get(): SqliteRunRepository {
    this.#repository ??= this.createRepository();
    return this.#repository;
  }
}

export function createApplicationComposition(
  options: ApplicationCompositionOptions = {},
): ApplicationComposition {
  const git = new GitRepositoryService();
  const runRepository = new LazyRunRepository(() =>
    createSqliteRunRepository({ nativeBinding: options.sqliteNativeBinding }),
  );
  const verification = new VerificationRunner(new GenericCommandAdapter());

  const application = new VerifierApplication({
    configuration: {
      exists: projectConfigExists,
      load: loadProjectConfig,
      loadPolicy: loadProjectPolicy,
      preview: previewProjectConfig,
      migrationPreview: previewProjectConfigMigration,
      migrationApply: applyProjectConfigMigration,
      discover: discoverProject,
      initialize: initializeProjectConfig,
      path: getProjectConfigPath,
    },
    repository: {
      resolveRoot: (startPath) => git.discoverRoot(startPath),
      inspect: (startPath) => git.inspect(startPath),
    },
    profiler: options.profiler ?? createProjectProfiler(),
    verification,
    runs: runRepository,
    approvals: runRepository,
  });

  return {
    application,
    close: () => runRepository.close(),
  };
}
