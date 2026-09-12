export const PROJECT_PROFILE_VERSION = 1 as const;

export const PROJECT_PROFILE_CONFIDENCE_LEVELS = ['confirmed', 'strong', 'tentative'] as const;
export type ProjectProfileConfidence = (typeof PROJECT_PROFILE_CONFIDENCE_LEVELS)[number];

export const PROJECT_EVIDENCE_KINDS = [
  'manifest',
  'config',
  'lockfile',
  'script',
  'path',
  'convention',
] as const;
export type ProjectEvidenceKind = (typeof PROJECT_EVIDENCE_KINDS)[number];

export const PROJECT_CAPABILITY_KINDS = [
  'language',
  'framework',
  'package-manager',
  'workspace-system',
  'test-framework',
  'build-tool',
  'linter',
  'typechecker',
  'runtime',
  'preview',
] as const;
export type ProjectCapabilityKind = (typeof PROJECT_CAPABILITY_KINDS)[number];

export const PROJECT_TASK_KINDS = ['test', 'build', 'lint', 'typecheck', 'run', 'preview'] as const;
export type ProjectTaskKind = (typeof PROJECT_TASK_KINDS)[number];

export const PROJECT_SCAN_LIMITS = [
  'entries',
  'file-bytes',
  'aggregate-bytes',
  'elapsed-time',
] as const;
export type ProjectScanLimit = (typeof PROJECT_SCAN_LIMITS)[number];

export type ProjectProfileCompleteness = 'complete' | 'partial';
export type ProjectProfilePhase = 'inventory' | 'sensors' | 'finalizing';

export interface ProjectEvidence {
  readonly id: string;
  readonly sensorId: string;
  readonly kind: ProjectEvidenceKind;
  readonly path: string;
  readonly pointer?: readonly string[];
  readonly summary: string;
}

export interface ProjectCapability {
  readonly id: string;
  readonly kind: ProjectCapabilityKind;
  readonly name: string;
  readonly confidence: ProjectProfileConfidence;
  readonly evidenceIds: readonly string[];
}

export interface ProjectWorkspaceUnit {
  readonly id: string;
  readonly path: string;
  readonly name?: string;
  readonly evidenceIds: readonly string[];
}

export interface ProjectTaskCandidate {
  readonly id: string;
  readonly kind: ProjectTaskKind;
  readonly label: string;
  readonly command: string;
  readonly workingDirectory: string;
  readonly workspaceId?: string;
  readonly confidence: ProjectProfileConfidence;
  readonly evidenceIds: readonly string[];
}

export interface ProjectProfileAmbiguity {
  readonly code: string;
  readonly message: string;
  readonly candidateIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface ProjectProfileWarning {
  readonly code: string;
  readonly message: string;
  readonly sensorId?: string;
  readonly path?: string;
  readonly affectsCompleteness: boolean;
}

export interface ProjectScanStatistics {
  readonly entriesScanned: number;
  readonly filesScanned: number;
  readonly directoriesScanned: number;
  readonly bytesRead: number;
  readonly skippedDirectories: number;
  readonly elapsedMs: number;
  readonly limitsReached: readonly ProjectScanLimit[];
}

export interface ProjectProfile {
  readonly profileVersion: typeof PROJECT_PROFILE_VERSION;
  readonly repositoryRoot: string;
  readonly displayName: string;
  readonly generatedAt: string;
  readonly completeness: ProjectProfileCompleteness;
  readonly scan: ProjectScanStatistics;
  readonly capabilities: readonly ProjectCapability[];
  readonly workspaceUnits: readonly ProjectWorkspaceUnit[];
  readonly taskCandidates: readonly ProjectTaskCandidate[];
  readonly evidence: readonly ProjectEvidence[];
  readonly ambiguities: readonly ProjectProfileAmbiguity[];
  readonly warnings: readonly ProjectProfileWarning[];
}

export interface ProjectProfileProgress {
  readonly phase: ProjectProfilePhase;
  readonly message: string;
  readonly entriesScanned: number;
  readonly bytesRead: number;
  readonly sensorsCompleted: number;
  readonly sensorCount: number;
}

export type ProjectProfileResult =
  | { readonly status: 'completed'; readonly profile: ProjectProfile }
  | { readonly status: 'cancelled' };
