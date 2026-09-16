import type {
  ConfigMigrationApplyOptions,
  ConfigMigrationApplyResult,
  ConfigMigrationPreview,
  InitializeProjectConfigOptions,
  InitializeProjectConfigResult,
  ProjectConfigPreview,
  ProjectConfigV1,
  ProjectConfigV2,
  ProjectDiscovery,
} from '@verify/config';
import type {
  ApprovalReceipt,
  ProjectProfileProgress,
  ProjectProfileResult,
  RepositoryChange,
  VerificationRun,
} from '@verify/domain';
import type { VerificationRunEvidence, VerificationRunRequest } from '@verify/verification';

export interface ConfigurationPort {
  exists(repositoryRoot: string): Promise<boolean>;
  load(repositoryRoot: string): Promise<ProjectConfigV1>;
  loadPolicy(repositoryRoot: string): Promise<ProjectConfigV1 | ProjectConfigV2>;
  migrationPreview(repositoryRoot: string): Promise<ConfigMigrationPreview>;
  migrationApply(options: ConfigMigrationApplyOptions): Promise<ConfigMigrationApplyResult>;
  preview(repositoryRoot: string): Promise<ProjectConfigPreview>;
  discover(repositoryRoot: string): Promise<ProjectDiscovery>;
  initialize(options: InitializeProjectConfigOptions): Promise<InitializeProjectConfigResult>;
  path(repositoryRoot: string): string;
}

export interface RepositoryPort {
  resolveRoot(startPath: string): Promise<string>;
  inspect(startPath: string): Promise<RepositoryChange>;
}

export interface ProjectProfilerPort {
  profile(request: {
    readonly repositoryRoot: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: ProjectProfileProgress) => void;
  }): Promise<ProjectProfileResult>;
}

export interface VerificationExecutorPort {
  run(request: VerificationRunRequest): Promise<VerificationRunEvidence>;
}

export interface RunRepositoryPort {
  saveRun(run: VerificationRun): Promise<VerificationRun>;
  getLatestRun(repositoryRoot: string): Promise<VerificationRun | null>;
  listRuns(repositoryRoot: string, limit?: number): Promise<VerificationRun[]>;
}

/** Local authorization evidence; distinct from verification run history and repository YAML. */
export interface ApprovalReceiptPort {
  getLatestApprovalReceipt(repositoryRoot: string): Promise<ApprovalReceipt | null>;
  approvePolicyReceipt(receipt: ApprovalReceipt): Promise<ApprovalReceipt>;
  revokeActiveApprovalReceipt(
    repositoryRoot: string,
    revokedAt: string,
  ): Promise<ApprovalReceipt | null>;
}
