import type {
  ProjectCapability,
  ProjectEvidence,
  ProjectProfileAmbiguity,
  ProjectProfileProgress,
  ProjectProfileResult,
  ProjectProfileWarning,
  ProjectTaskCandidate,
  ProjectWorkspaceUnit,
} from '@verify/domain';

export interface ProjectScanLimits {
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  readonly maxElapsedMs: number;
}

export interface ProjectInventoryEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly size: number;
}

export interface ProjectInventory {
  readonly entries: readonly ProjectInventoryEntry[];
  readonly files: ReadonlyMap<string, ProjectInventoryEntry>;
  readonly traversalComplete: boolean;
}

export interface ProjectMetadataText {
  readonly text: string;
  readonly bytes: number;
}

export interface ProjectMetadataReader {
  readText(path: string): Promise<ProjectMetadataText | null>;
}

export interface ProjectSensorContext {
  readonly repositoryRoot: string;
  readonly inventory: ProjectInventory;
  readonly metadata: ProjectMetadataReader;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: ProjectProfileProgress) => void;
}

export interface ProjectSensorResult {
  readonly displayName?: string;
  readonly capabilities: readonly ProjectCapability[];
  readonly workspaceUnits: readonly ProjectWorkspaceUnit[];
  readonly taskCandidates: readonly ProjectTaskCandidate[];
  readonly evidence: readonly ProjectEvidence[];
  readonly ambiguities: readonly ProjectProfileAmbiguity[];
  readonly warnings: readonly ProjectProfileWarning[];
}

export interface ProjectSensor {
  readonly id: string;
  scan(context: ProjectSensorContext): Promise<ProjectSensorResult>;
}

export interface ProjectProfilerRequest {
  readonly repositoryRoot: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ProjectProfileProgress) => void;
}

export interface ProjectProfiler {
  profile(request: ProjectProfilerRequest): Promise<ProjectProfileResult>;
}

export interface ProjectProfilerOptions {
  readonly sensors?: readonly ProjectSensor[];
  readonly limits?: Partial<ProjectScanLimits>;
  readonly now?: () => number;
  readonly generatedAt?: () => Date;
}
