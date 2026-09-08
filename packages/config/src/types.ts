import type { FailurePolicy, VerificationSuite } from '@verify/domain';

export const PROJECT_CONFIG_VERSION = 1 as const;
export const PROJECT_CONFIG_DIRECTORY = '.verify' as const;
export const PROJECT_CONFIG_FILENAME = 'project.yml' as const;
export const PROJECT_CONFIG_RELATIVE_PATH = '.verify/project.yml' as const;

export interface ProjectConfigProjectV1 {
  readonly name: string;
}

export interface ProjectSuiteConfigV1 {
  readonly type: string;
  readonly command: string;
  readonly failure_policy: FailurePolicy;
  readonly timeout_ms?: number;
}

export interface ProjectConfigV1 {
  readonly version: typeof PROJECT_CONFIG_VERSION;
  readonly project: ProjectConfigProjectV1;
  readonly suites: Readonly<Record<string, ProjectSuiteConfigV1>>;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export type DetectedProjectType = 'node' | 'python' | 'typescript' | 'vite';

export interface ProjectSuiteSuggestion extends ProjectSuiteConfigV1 {
  readonly id: string;
  readonly reason: string;
}

export interface NodeProjectDiscovery {
  readonly packageManager: PackageManager | null;
  readonly packageName: string | null;
  readonly scripts: Readonly<Record<string, string>>;
}

export interface PythonProjectDiscovery {
  readonly pytestDetected: boolean;
}

export interface ProjectDiscovery {
  readonly repositoryRoot: string;
  readonly projectName: string;
  readonly projectTypes: readonly DetectedProjectType[];
  readonly markers: readonly string[];
  readonly node: NodeProjectDiscovery | null;
  readonly python: PythonProjectDiscovery | null;
  readonly suggestedSuites: readonly ProjectSuiteSuggestion[];
  readonly warnings: readonly string[];
}

export interface ProjectConfigPreview {
  readonly path: string;
  readonly exists: boolean;
  readonly discovery: ProjectDiscovery;
  readonly suggestedConfig: ProjectConfigV1;
}

export interface InitializeProjectConfigOptions {
  readonly repositoryRoot: string;
  readonly config?: ProjectConfigV1;
  readonly force?: boolean;
}

export interface InitializeProjectConfigResult {
  readonly path: string;
  readonly config: ProjectConfigV1;
  readonly discovery?: ProjectDiscovery;
  readonly overwritten: boolean;
}

export function toVerificationSuites(config: ProjectConfigV1): VerificationSuite[] {
  return Object.entries(config.suites).map(([id, suite]) => ({
    id,
    name: id,
    type: suite.type,
    command: suite.command,
    failurePolicy: suite.failure_policy,
    ...(suite.timeout_ms === undefined ? {} : { timeoutMs: suite.timeout_ms }),
  }));
}
