import { createHash } from 'node:crypto';

import type {
  ProjectCapability,
  ProjectEvidence,
  ProjectProfileAmbiguity,
  ProjectProfileWarning,
  ProjectTaskCandidate,
  ProjectTaskKind,
  ProjectWorkspaceUnit,
} from '@verify/domain';

import { throwIfProjectProfileCancelled } from '../cancelled.js';
import type { ProjectSensor, ProjectSensorContext, ProjectSensorResult } from '../contracts.js';
import { compareText } from '../ordering.js';

const SENSOR_ID = 'workspace';
const ROOT_PACKAGE_MANIFEST = 'package.json';
const PNPM_WORKSPACE_MANIFEST = 'pnpm-workspace.yaml';

type NodePackageManager = 'npm' | 'pnpm' | 'yarn';

interface ParsedPackageManifest {
  readonly name?: string;
  readonly packageManager?: NodePackageManager;
  readonly scripts: Readonly<Record<string, string>>;
  readonly workspaceDeclaration?: {
    readonly patterns: readonly string[];
    readonly pointer: readonly string[];
  };
}

interface PatternSource {
  readonly evidence: ProjectEvidence;
  readonly patterns: readonly string[];
}

interface NormalizedWorkspacePattern {
  readonly excluded: boolean;
  readonly expression: RegExp;
}

class InvalidWorkspaceDeclarationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].trim().length > 0,
    ),
  );
}

function parseStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) return null;
    result.push(item.trim());
  }
  return result;
}

function supportedManager(value: unknown): NodePackageManager | undefined {
  if (typeof value !== 'string') return undefined;
  const manager = value.trim().split('@', 1)[0]?.toLowerCase();
  return manager === 'npm' || manager === 'pnpm' || manager === 'yarn' ? manager : undefined;
}

function workspaceDeclaration(
  value: Record<string, unknown>,
): ParsedPackageManifest['workspaceDeclaration'] | null | undefined {
  if (!Object.hasOwn(value, 'workspaces')) return undefined;
  const declared = value.workspaces;
  const directPatterns = parseStringArray(declared);
  if (directPatterns !== null) {
    return { patterns: directPatterns, pointer: ['workspaces'] };
  }
  if (!isRecord(declared)) return null;
  const objectPatterns = parseStringArray(declared.packages);
  if (objectPatterns === null) return null;
  return {
    patterns: objectPatterns,
    pointer: ['workspaces', 'packages'],
  };
}

function parsePackageManifest(source: string): ParsedPackageManifest {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Error('package.json must contain a JSON object.');
  const declaration = workspaceDeclaration(value);
  if (declaration === null) {
    throw new InvalidWorkspaceDeclarationError(
      'package.json workspaces must be an array or an object with a packages array.',
    );
  }
  return {
    ...(typeof value.name === 'string' && value.name.trim().length > 0
      ? { name: value.name.trim() }
      : {}),
    ...(supportedManager(value.packageManager) === undefined
      ? {}
      : { packageManager: supportedManager(value.packageManager) }),
    scripts: parseStringRecord(value.scripts),
    ...(declaration === undefined ? {} : { workspaceDeclaration: declaration }),
  };
}

function parsePnpmWorkspace(source: string): readonly string[] {
  const lines = source.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  const patterns: string[] = [];
  let inPackages = false;
  let packagesIndent = -1;

  for (const line of lines) {
    if (/^\s*(?:#.*)?$/u.test(line)) continue;
    if (line.includes('\t')) throw new Error('pnpm workspace indentation must use spaces.');
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (!inPackages) {
      const key = /^packages\s*:\s*(?:#.*)?$/u.exec(line);
      if (key === null) continue;
      inPackages = true;
      packagesIndent = 0;
      continue;
    }

    if (indent <= packagesIndent) break;
    const item = /^-\s+(.+)$/u.exec(trimmed);
    if (item === null) throw new Error('pnpm workspace packages must be a scalar YAML sequence.');
    const scalar = parseYamlScalar(item[1] ?? '');
    if (scalar.length === 0) throw new Error('pnpm workspace patterns must not be empty.');
    patterns.push(scalar);
  }

  if (!inPackages) throw new Error('pnpm-workspace.yaml does not declare a packages sequence.');
  if (patterns.length === 0) {
    throw new Error('pnpm-workspace.yaml must declare at least one package pattern.');
  }
  return patterns;
}

function parseYamlScalar(source: string): string {
  const value = source.trim();
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error('Invalid quoted YAML scalar.');
    return value.slice(1, -1).replaceAll("''", "'").trim();
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== 'string') throw new Error('Expected a string.');
      return parsed.trim();
    } catch (error) {
      throw new Error(
        `Invalid quoted YAML scalar: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return value.replace(/\s+#.*$/u, '').trim();
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizePattern(value: string): NormalizedWorkspacePattern | null {
  const excluded = value.startsWith('!');
  let pattern = excluded ? value.slice(1) : value;
  if (pattern.startsWith('./')) pattern = pattern.slice(2);
  pattern = pattern.replace(/\/+$/u, '');
  if (
    pattern.length === 0 ||
    pattern === '.' ||
    pattern.startsWith('/') ||
    pattern.includes('\\') ||
    pattern
      .split('/')
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    ['?', '[', ']', '{', '}'].some((character) => pattern.includes(character))
  ) {
    return null;
  }

  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character !== '*') {
      expression += escapeRegularExpression(character ?? '');
      continue;
    }
    if (pattern[index + 1] === '*') {
      expression += '.*';
      index += 1;
    } else {
      expression += '[^/]*';
    }
  }
  expression += '$';
  return { excluded, expression: new RegExp(expression, 'u') };
}

function matchedBy(path: string, patterns: readonly NormalizedWorkspacePattern[]): boolean {
  const includes = patterns.filter((pattern) => !pattern.excluded);
  const excludes = patterns.filter((pattern) => pattern.excluded);
  return (
    includes.some((pattern) => pattern.expression.test(path)) &&
    !excludes.some((pattern) => pattern.expression.test(path))
  );
}

function stableSuffix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function scriptKind(name: string): ProjectTaskKind | null {
  if (name === 'test' || name.startsWith('test:')) return 'test';
  if (name === 'build' || name.startsWith('build:')) return 'build';
  if (name === 'lint' || name.startsWith('lint:')) return 'lint';
  if (name === 'typecheck' || name.startsWith('typecheck:') || name === 'check:types') {
    return 'typecheck';
  }
  if (name === 'dev' || name === 'start' || name === 'serve') return 'run';
  if (name === 'preview') return 'preview';
  return null;
}

function taskLabel(kind: ProjectTaskKind, packageName: string, scriptName: string): string {
  const action = kind === 'run' ? 'Run' : kind === 'preview' ? 'Preview' : `Run ${kind}`;
  return `${action} (${packageName}:${scriptName})`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

export class WorkspaceProjectSensor implements ProjectSensor {
  public readonly id = SENSOR_ID;

  public async scan(context: ProjectSensorContext): Promise<ProjectSensorResult> {
    throwIfProjectProfileCancelled(context.signal);
    const evidence: ProjectEvidence[] = [];
    const capabilities: ProjectCapability[] = [];
    const workspaceUnits: ProjectWorkspaceUnit[] = [];
    const taskCandidates: ProjectTaskCandidate[] = [];
    const ambiguities: ProjectProfileAmbiguity[] = [];
    const warnings: ProjectProfileWarning[] = [];
    const patternSources: PatternSource[] = [];
    let rootManifest: ParsedPackageManifest | null = null;

    const addEvidence = (item: ProjectEvidence): ProjectEvidence => {
      evidence.push(item);
      return item;
    };
    const addWarning = (code: string, message: string, path: string): void => {
      warnings.push({ code, message, sensorId: SENSOR_ID, path, affectsCompleteness: true });
    };

    if (context.inventory.files.has(ROOT_PACKAGE_MANIFEST)) {
      try {
        const source = await context.metadata.readText(ROOT_PACKAGE_MANIFEST);
        if (source !== null) rootManifest = parsePackageManifest(source.text);
      } catch (error) {
        if (error instanceof InvalidWorkspaceDeclarationError) {
          addWarning(
            'WORKSPACE_PACKAGE_MANIFEST_INVALID',
            `Could not parse package.json workspace metadata: ${error.message}`,
            ROOT_PACKAGE_MANIFEST,
          );
        }
      }
    }

    throwIfProjectProfileCancelled(context.signal);
    const managerEvidence = new Map<NodePackageManager, ProjectEvidence[]>();
    if (rootManifest?.workspaceDeclaration !== undefined) {
      const declarationEvidence = addEvidence({
        id: 'workspace.manifest.package-json-workspaces',
        sensorId: SENSOR_ID,
        kind: 'manifest',
        path: ROOT_PACKAGE_MANIFEST,
        pointer: rootManifest.workspaceDeclaration.pointer,
        summary: 'package.json explicitly declares workspace package patterns.',
      });
      patternSources.push({
        evidence: declarationEvidence,
        patterns: rootManifest.workspaceDeclaration.patterns,
      });

      if (rootManifest.packageManager !== undefined) {
        const item = addEvidence({
          id: `workspace.manifest.package-manager.${rootManifest.packageManager}`,
          sensorId: SENSOR_ID,
          kind: 'manifest',
          path: ROOT_PACKAGE_MANIFEST,
          pointer: ['packageManager'],
          summary: `package.json declares ${rootManifest.packageManager} as its package manager.`,
        });
        managerEvidence.set(rootManifest.packageManager, [item]);
      }
      for (const [lockfile, manager] of [
        ['package-lock.json', 'npm'],
        ['pnpm-lock.yaml', 'pnpm'],
        ['yarn.lock', 'yarn'],
      ] as const) {
        if (!context.inventory.files.has(lockfile)) continue;
        const item = addEvidence({
          id: `workspace.lockfile.${manager}`,
          sensorId: SENSOR_ID,
          kind: 'lockfile',
          path: lockfile,
          summary: `${manager} lockfile supports the declared workspace system.`,
        });
        managerEvidence.set(manager, [...(managerEvidence.get(manager) ?? []), item]);
      }
    }

    let pnpmWorkspaceEvidence: ProjectEvidence | undefined;
    if (context.inventory.files.has(PNPM_WORKSPACE_MANIFEST)) {
      const marker = addEvidence({
        id: 'workspace.config.pnpm-workspace',
        sensorId: SENSOR_ID,
        kind: 'config',
        path: PNPM_WORKSPACE_MANIFEST,
        pointer: ['packages'],
        summary: 'pnpm-workspace.yaml explicitly declares workspace package patterns.',
      });
      try {
        const source = await context.metadata.readText(PNPM_WORKSPACE_MANIFEST);
        if (source !== null) {
          const patterns = parsePnpmWorkspace(source.text);
          pnpmWorkspaceEvidence = marker;
          patternSources.push({
            evidence: marker,
            patterns,
          });
        }
      } catch (error) {
        addWarning(
          'PNPM_WORKSPACE_MANIFEST_INVALID',
          `Could not parse pnpm-workspace.yaml: ${error instanceof Error ? error.message : String(error)}`,
          PNPM_WORKSPACE_MANIFEST,
        );
      }
    }

    const systemCapabilities = new Map<string, ProjectEvidence[]>();
    const packageDeclaration = patternSources.find(
      (source) => source.evidence.id === 'workspace.manifest.package-json-workspaces',
    );
    if (packageDeclaration !== undefined) {
      const compatibleManagers = [...managerEvidence.keys()].filter(
        (manager): manager is 'npm' | 'yarn' => manager === 'npm' || manager === 'yarn',
      );
      if (compatibleManagers.length === 0 && pnpmWorkspaceEvidence === undefined) {
        systemCapabilities.set('workspace-system.node', [packageDeclaration.evidence]);
      }
      for (const manager of compatibleManagers) {
        systemCapabilities.set(`workspace-system.${manager}`, [
          packageDeclaration.evidence,
          ...(managerEvidence.get(manager) ?? []),
        ]);
      }
    }
    if (pnpmWorkspaceEvidence !== undefined) {
      systemCapabilities.set('workspace-system.pnpm', [
        pnpmWorkspaceEvidence,
        ...(managerEvidence.get('pnpm') ?? []),
      ]);
    }
    for (const [id, items] of [...systemCapabilities].sort(([left], [right]) =>
      compareText(left, right),
    )) {
      const name =
        id === 'workspace-system.node'
          ? 'Node.js workspaces'
          : `${id.slice('workspace-system.'.length)} workspaces`;
      capabilities.push({
        id,
        kind: 'workspace-system',
        name,
        confidence: 'confirmed',
        evidenceIds: uniqueSorted(items.map((item) => item.id)),
      });
    }
    if (systemCapabilities.size > 1) {
      ambiguities.push({
        code: 'WORKSPACE_SYSTEM_CONFLICT',
        message: 'Multiple declared Node workspace systems remain credible.',
        candidateIds: [...systemCapabilities.keys()].sort(compareText),
        evidenceIds: uniqueSorted([...systemCapabilities.values()].flat().map((item) => item.id)),
      });
    }

    const normalizedSources = patternSources.map((source) => {
      const patterns: NormalizedWorkspacePattern[] = [];
      for (const pattern of source.patterns) {
        const normalized = normalizePattern(pattern);
        if (normalized === null) {
          addWarning(
            'WORKSPACE_PATTERN_UNSUPPORTED',
            `Ignored an unsupported or non-contained workspace pattern in ${source.evidence.path}.`,
            source.evidence.path,
          );
        } else {
          patterns.push(normalized);
        }
      }
      return { evidence: source.evidence, patterns };
    });

    const packagePaths = [...context.inventory.files.keys()]
      .filter((path) => path.endsWith('/package.json'))
      .sort(compareText);
    for (const manifestPath of packagePaths) {
      throwIfProjectProfileCancelled(context.signal);
      const packageRoot = manifestPath.slice(0, -'/package.json'.length);
      const matchingSources = normalizedSources.filter((source) =>
        matchedBy(packageRoot, source.patterns),
      );
      if (matchingSources.length === 0) continue;

      const packageEvidence = addEvidence({
        id: `workspace.manifest.unit.${stableSuffix(packageRoot)}`,
        sensorId: SENSOR_ID,
        kind: 'manifest',
        path: manifestPath,
        summary: 'A declared workspace root contains a package manifest.',
      });
      let manifest: ParsedPackageManifest | null = null;
      try {
        const source = await context.metadata.readText(manifestPath);
        if (source !== null) manifest = parsePackageManifest(source.text);
      } catch (error) {
        addWarning(
          'WORKSPACE_UNIT_MANIFEST_INVALID',
          `Could not parse workspace package manifest: ${error instanceof Error ? error.message : String(error)}`,
          manifestPath,
        );
      }

      const workspaceId = `workspace.node.${stableSuffix(packageRoot)}`;
      const declarationEvidenceIds = matchingSources.map((source) => source.evidence.id);
      workspaceUnits.push({
        id: workspaceId,
        path: packageRoot,
        ...(manifest?.name === undefined ? {} : { name: manifest.name }),
        evidenceIds: uniqueSorted([...declarationEvidenceIds, packageEvidence.id]),
      });

      if (manifest === null) continue;
      for (const [scriptName, command] of Object.entries(manifest.scripts).sort(([left], [right]) =>
        compareText(left, right),
      )) {
        const kind = scriptKind(scriptName);
        if (kind === null) continue;
        const scriptEvidence = addEvidence({
          id: `workspace.script.${stableSuffix(packageRoot)}.${stableSuffix(scriptName)}`,
          sensorId: SENSOR_ID,
          kind: 'script',
          path: manifestPath,
          pointer: ['scripts', scriptName],
          summary: `The workspace package manifest declares the ${scriptName} script.`,
        });
        taskCandidates.push({
          id: `task.workspace.${stableSuffix(packageRoot)}.${kind}.${stableSuffix(scriptName)}`,
          kind,
          label: taskLabel(kind, manifest.name ?? packageRoot, scriptName),
          command,
          workingDirectory: packageRoot,
          workspaceId,
          confidence: 'confirmed',
          evidenceIds: [scriptEvidence.id],
        });
      }
    }

    if (workspaceUnits.length > 1) {
      ambiguities.push({
        code: 'MULTIPLE_WORKSPACE_TARGETS',
        message: 'Multiple declared workspace package roots remain credible; none is selected.',
        candidateIds: workspaceUnits.map((unit) => unit.id).sort(compareText),
        evidenceIds: uniqueSorted(workspaceUnits.flatMap((unit) => unit.evidenceIds)),
      });
    }

    return {
      capabilities: capabilities.sort((left, right) => compareText(left.id, right.id)),
      workspaceUnits: workspaceUnits.sort((left, right) => compareText(left.id, right.id)),
      taskCandidates: taskCandidates.sort((left, right) => compareText(left.id, right.id)),
      evidence: evidence.sort((left, right) => compareText(left.id, right.id)),
      ambiguities: ambiguities.sort((left, right) => compareText(left.code, right.code)),
      warnings: warnings.sort((left, right) => {
        const code = compareText(left.code, right.code);
        return code === 0 ? compareText(left.message, right.message) : code;
      }),
    };
  }
}
