import type {
  InitializeProjectConfigOptions,
  InitializeProjectConfigResult,
  ProjectConfigPreview,
  ProjectConfigV1,
  ProjectDiscovery,
} from '@verify/config';
import type { RepositoryChange, VerificationRun } from '@verify/domain';
import type { VerificationRunEvidence, VerificationRunRequest } from '@verify/verification';

export interface ConfigurationPort {
  exists(repositoryRoot: string): Promise<boolean>;
  load(repositoryRoot: string): Promise<ProjectConfigV1>;
  preview(repositoryRoot: string): Promise<ProjectConfigPreview>;
  discover(repositoryRoot: string): Promise<ProjectDiscovery>;
  initialize(options: InitializeProjectConfigOptions): Promise<InitializeProjectConfigResult>;
  path(repositoryRoot: string): string;
}

export interface RepositoryPort {
  resolveRoot(startPath: string): Promise<string>;
  inspect(startPath: string): Promise<RepositoryChange>;
}

export interface VerificationExecutorPort {
  run(request: VerificationRunRequest): Promise<VerificationRunEvidence>;
}

export interface RunRepositoryPort {
  saveRun(run: VerificationRun): Promise<VerificationRun>;
  getLatestRun(repositoryRoot: string): Promise<VerificationRun | null>;
  listRuns(repositoryRoot: string, limit?: number): Promise<VerificationRun[]>;
}
