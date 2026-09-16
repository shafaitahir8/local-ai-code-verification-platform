import type { ApprovalReceipt, Project, VerificationRun } from '@verify/domain';

/** Persistence boundary consumed by core verification and history use cases. */
export interface RunRepository {
  saveRun(run: VerificationRun): Promise<VerificationRun>;
  getLatestRun(repositoryRoot: string): Promise<VerificationRun | null>;
  listRuns(repositoryRoot: string, limit?: number): Promise<VerificationRun[]>;
  close(): void;
}

/** Optional project metadata boundary owned by the storage package. */
export interface ProjectRepository {
  saveProject(project: Project): Promise<Project>;
  getProject(repositoryRoot: string): Promise<Project | null>;
}

/** Local, historical approval evidence. The current policy digest is evaluated by core. */
export interface ApprovalReceiptRepository {
  getLatestApprovalReceipt(repositoryRoot: string): Promise<ApprovalReceipt | null>;
  approvePolicyReceipt(receipt: ApprovalReceipt): Promise<ApprovalReceipt>;
  revokeActiveApprovalReceipt(
    repositoryRoot: string,
    revokedAt: string,
  ): Promise<ApprovalReceipt | null>;
}
