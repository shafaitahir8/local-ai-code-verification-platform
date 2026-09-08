import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import {
  PROJECT_CONFIG_VERSION,
  type DetectedProjectType,
  type PackageManager,
  type ProjectConfigV1,
  type ProjectDiscovery,
  type ProjectSuiteSuggestion,
} from './types.js';

const NODE_SCRIPT_SUGGESTIONS = [
  { id: 'test', type: 'test', failure_policy: 'block' },
  { id: 'lint', type: 'lint', failure_policy: 'warn' },
  { id: 'typecheck', type: 'typecheck', failure_policy: 'block' },
  { id: 'build', type: 'build', failure_policy: 'block' },
] as const;

const MARKER_NAMES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  'pyproject.toml',
  'pytest.ini',
  'requirements.txt',
] as const;

interface ParsedPackageJson {
  readonly name: string | null;
  readonly packageManager: string | null;
  readonly scripts: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePackageJson(source: string): ParsedPackageJson {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) {
    throw new Error('package.json must contain a JSON object.');
  }

  const scripts: Record<string, string> = {};
  if (isRecord(value.scripts)) {
    for (const [name, command] of Object.entries(value.scripts)) {
      if (typeof command === 'string' && command.trim().length > 0) {
        scripts[name] = command;
      }
    }
  }

  return {
    name: typeof value.name === 'string' && value.name.trim().length > 0 ? value.name.trim() : null,
    packageManager:
      typeof value.packageManager === 'string' && value.packageManager.trim().length > 0
        ? value.packageManager.trim()
        : null,
    scripts,
  };
}

function managerFromDeclaration(declaration: string): PackageManager | null {
  const name = declaration.split('@', 1)[0]?.toLowerCase();
  return name === 'npm' || name === 'pnpm' || name === 'yarn' ? name : null;
}

function detectPackageManager(
  packageManagerDeclaration: string | null,
  markerSet: ReadonlySet<string>,
  warnings: string[],
): PackageManager | null {
  if (packageManagerDeclaration !== null) {
    const declared = managerFromDeclaration(packageManagerDeclaration);
    if (declared !== null) {
      return declared;
    }

    warnings.push(
      `Unsupported package manager declaration "${packageManagerDeclaration}"; Node commands were not suggested.`,
    );
    return null;
  }

  const lockManagers = [
    markerSet.has('pnpm-lock.yaml') ? ('pnpm' as const) : null,
    markerSet.has('yarn.lock') ? ('yarn' as const) : null,
    markerSet.has('package-lock.json') ? ('npm' as const) : null,
  ].filter((manager): manager is PackageManager => manager !== null);

  if (lockManagers.length > 1) {
    warnings.push(
      `Multiple package-manager lockfiles found; using ${lockManagers[0] ?? 'no package manager'} for suggestions.`,
    );
  }

  return lockManagers[0] ?? 'npm';
}

function packageScriptCommand(packageManager: PackageManager, scriptName: string): string {
  if (packageManager === 'npm' && scriptName === 'test') {
    return 'npm test';
  }

  if (packageManager === 'yarn') {
    return `yarn run ${scriptName}`;
  }

  return `${packageManager} run ${scriptName}`;
}

function hasPytestEvidence(
  markerSet: ReadonlySet<string>,
  pyproject: string | null,
  requirements: string | null,
): boolean {
  if (markerSet.has('pytest.ini')) {
    return true;
  }

  if (pyproject !== null && /^\s*\[tool\.pytest(?:\.ini_options)?\]\s*$/mu.test(pyproject)) {
    return true;
  }

  return (
    requirements !== null &&
    /^\s*pytest(?:\[[^\]]+\])?(?:\s*(?:[<>=!~]=?|===).*)?(?:\s*#.*)?$/imu.test(requirements)
  );
}

async function readOptionalMarker(
  repositoryRoot: string,
  marker: string,
  warnings: string[],
): Promise<string | null> {
  try {
    return await readFile(resolve(repositoryRoot, marker), 'utf8');
  } catch (error) {
    warnings.push(
      `Could not read ${marker}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function discoverProject(repositoryRoot: string): Promise<ProjectDiscovery> {
  const normalizedRoot = resolve(repositoryRoot);
  const entries = await readdir(normalizedRoot, { withFileTypes: true });
  const fileNames = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  const fileNameSet = new Set(fileNames);
  const configMarkers = fileNames.filter((name) =>
    /^(?:vite|vitest|jest|playwright)\.config\.(?:[cm]?[jt]s)$/u.test(name),
  );
  const markers = [
    ...MARKER_NAMES.filter((marker) => fileNameSet.has(marker)),
    ...configMarkers.sort(),
  ];
  const markerSet = new Set(markers);
  const warnings: string[] = [];

  let packageJson: ParsedPackageJson | null = null;
  if (markerSet.has('package.json')) {
    const source = await readOptionalMarker(normalizedRoot, 'package.json', warnings);
    if (source !== null) {
      try {
        packageJson = parsePackageJson(source);
      } catch (error) {
        warnings.push(
          `Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const packageManager =
    packageJson === null
      ? null
      : detectPackageManager(packageJson.packageManager, markerSet, warnings);
  const pyproject = markerSet.has('pyproject.toml')
    ? await readOptionalMarker(normalizedRoot, 'pyproject.toml', warnings)
    : null;
  const requirements = markerSet.has('requirements.txt')
    ? await readOptionalMarker(normalizedRoot, 'requirements.txt', warnings)
    : null;
  const pytestDetected = hasPytestEvidence(markerSet, pyproject, requirements);

  const projectTypes: DetectedProjectType[] = [];
  if (markerSet.has('package.json')) projectTypes.push('node');
  if (markerSet.has('tsconfig.json')) projectTypes.push('typescript');
  if (configMarkers.some((name) => name.startsWith('vite.config.'))) projectTypes.push('vite');
  if (
    markerSet.has('pyproject.toml') ||
    markerSet.has('pytest.ini') ||
    markerSet.has('requirements.txt')
  ) {
    projectTypes.push('python');
  }

  const suggestedSuites: ProjectSuiteSuggestion[] = [];
  if (packageJson !== null && packageManager !== null) {
    for (const suggestion of NODE_SCRIPT_SUGGESTIONS) {
      if (Object.hasOwn(packageJson.scripts, suggestion.id)) {
        suggestedSuites.push({
          id: suggestion.id,
          type: suggestion.type,
          command: packageScriptCommand(packageManager, suggestion.id),
          failure_policy: suggestion.failure_policy,
          reason: `package.json defines the "${suggestion.id}" script.`,
        });
      }
    }
  }

  if (pytestDetected) {
    const id = suggestedSuites.some((suite) => suite.id === 'test') ? 'pytest' : 'test';
    suggestedSuites.push({
      id,
      type: 'test',
      command: 'pytest',
      failure_policy: 'block',
      reason: 'Pytest configuration or dependency evidence was found.',
    });
  }

  return {
    repositoryRoot: normalizedRoot,
    projectName: packageJson?.name ?? (basename(normalizedRoot) || 'project'),
    projectTypes,
    markers,
    node: markerSet.has('package.json')
      ? {
          packageManager,
          packageName: packageJson?.name ?? null,
          scripts: packageJson?.scripts ?? {},
        }
      : null,
    python: projectTypes.includes('python')
      ? {
          pytestDetected,
        }
      : null,
    suggestedSuites,
    warnings,
  };
}

export function createSuggestedProjectConfig(discovery: ProjectDiscovery): ProjectConfigV1 {
  return {
    version: PROJECT_CONFIG_VERSION,
    project: { name: discovery.projectName },
    suites: Object.fromEntries(
      discovery.suggestedSuites.map((suggestion) => [
        suggestion.id,
        {
          type: suggestion.type,
          command: suggestion.command,
          failure_policy: suggestion.failure_policy,
          ...(suggestion.timeout_ms === undefined ? {} : { timeout_ms: suggestion.timeout_ms }),
        },
      ]),
    ),
  };
}
