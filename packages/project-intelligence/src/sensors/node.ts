import type {
  ProjectCapability,
  ProjectEvidence,
  ProjectProfileAmbiguity,
  ProjectProfileConfidence,
  ProjectProfileWarning,
  ProjectTaskCandidate,
  ProjectTaskKind,
  ProjectWorkspaceUnit,
} from '@verify/domain';

import { throwIfProjectProfileCancelled } from '../cancelled.js';
import type { ProjectSensor, ProjectSensorContext, ProjectSensorResult } from '../contracts.js';
import { compareText } from '../ordering.js';

const SENSOR_ID = 'node';
const VITE_CONFIG_PATTERN = /^(?:vite|vitest)\.config\.(?:[cm]?[jt]s)$/u;
const JEST_CONFIG_PATTERN = /^jest\.config\.(?:[cm]?[jt]s|json)$/u;
const DIRECT_JEST_SCRIPT_PATTERN =
  /^(?:(?:npx|npm exec|pnpm exec|yarn exec)\s+(?:--\s+)?)?jest(?:\s|$)/u;
const DIRECT_VITE_SCRIPT_PATTERN =
  /^(?:(?:npx|npm exec|pnpm exec|yarn exec)\s+(?:--\s+)?)?vite(?:\s|$)/u;
const TEST_PATH_PATTERN =
  /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/u;

interface PackageManifest {
  readonly name?: string;
  readonly packageManager?: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
}

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

function parseManifest(source: string): PackageManifest {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Error('package.json must contain a JSON object.');

  const dependencies = new Map<string, string[]>();
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    if (!isRecord(value[section])) continue;
    for (const [name, version] of Object.entries(value[section]).sort(([left], [right]) =>
      compareText(left, right),
    )) {
      if (typeof version !== 'string' || version.trim().length === 0) continue;
      const locations = dependencies.get(name) ?? [];
      locations.push(section);
      dependencies.set(name, locations);
    }
  }

  return {
    ...(typeof value.name === 'string' && value.name.trim().length > 0
      ? { name: value.name.trim() }
      : {}),
    ...(typeof value.packageManager === 'string' && value.packageManager.trim().length > 0
      ? { packageManager: value.packageManager.trim() }
      : {}),
    scripts: parseStringRecord(value.scripts),
    dependencies,
  };
}

function stableSuffix(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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

function confidenceFor(evidence: readonly ProjectEvidence[]): ProjectProfileConfidence {
  if (evidence.some((item) => ['manifest', 'config', 'lockfile', 'script'].includes(item.kind))) {
    return 'confirmed';
  }
  return evidence.length > 1 ? 'strong' : 'tentative';
}

function supportedManager(declaration: string): 'npm' | 'pnpm' | 'yarn' | null {
  const manager = declaration.split('@', 1)[0]?.toLowerCase();
  return manager === 'npm' || manager === 'pnpm' || manager === 'yarn' ? manager : null;
}

export class NodeProjectSensor implements ProjectSensor {
  public readonly id = SENSOR_ID;

  public async scan(context: ProjectSensorContext): Promise<ProjectSensorResult> {
    throwIfProjectProfileCancelled(context.signal);
    const evidence: ProjectEvidence[] = [];
    const capabilities: ProjectCapability[] = [];
    const taskCandidates: ProjectTaskCandidate[] = [];
    const workspaceUnits: ProjectWorkspaceUnit[] = [];
    const ambiguities: ProjectProfileAmbiguity[] = [];
    const warnings: ProjectProfileWarning[] = [];
    let manifest: PackageManifest | null = null;

    const addEvidence = (item: ProjectEvidence): ProjectEvidence => {
      evidence.push(item);
      return item;
    };
    const addCapability = (
      id: string,
      kind: ProjectCapability['kind'],
      name: string,
      items: readonly ProjectEvidence[],
    ): void => {
      capabilities.push({
        id,
        kind,
        name,
        confidence: confidenceFor(items),
        evidenceIds: items.map((item) => item.id),
      });
    };

    if (context.inventory.files.has('package.json')) {
      const packageEvidence = addEvidence({
        id: 'node.manifest.package-json',
        sensorId: SENSOR_ID,
        kind: 'manifest',
        path: 'package.json',
        summary: 'Node package manifest is present.',
      });
      addCapability('runtime.node', 'runtime', 'Node.js', [packageEvidence]);

      try {
        const source = await context.metadata.readText('package.json');
        if (source !== null) manifest = parseManifest(source.text);
      } catch (error) {
        warnings.push({
          code: 'PACKAGE_MANIFEST_INVALID',
          message: `Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`,
          sensorId: SENSOR_ID,
          path: 'package.json',
          affectsCompleteness: true,
        });
      }
    }

    throwIfProjectProfileCancelled(context.signal);
    const configPaths = [...context.inventory.files.keys()]
      .filter(
        (path) =>
          !path.includes('/') && (VITE_CONFIG_PATTERN.test(path) || JEST_CONFIG_PATTERN.test(path)),
      )
      .sort(compareText);
    const viteEvidence: ProjectEvidence[] = [];
    const vitestEvidence: ProjectEvidence[] = [];
    const jestEvidence: ProjectEvidence[] = [];
    for (const path of configPaths) {
      let tool: 'vite' | 'vitest' | 'jest' = 'vite';
      if (path.startsWith('vitest.')) tool = 'vitest';
      else if (path.startsWith('jest.')) tool = 'jest';
      const toolName = { jest: 'Jest', vite: 'Vite', vitest: 'Vitest' }[tool];
      const item = addEvidence({
        id: `node.config.${tool}.${stableSuffix(path)}`,
        sensorId: SENSOR_ID,
        kind: 'config',
        path,
        summary: `${toolName} configuration is present.`,
      });
      if (tool === 'vite') viteEvidence.push(item);
      else if (tool === 'vitest') vitestEvidence.push(item);
      else jestEvidence.push(item);
    }

    const managerEvidence = new Map<'npm' | 'pnpm' | 'yarn', ProjectEvidence[]>();
    if (manifest?.packageManager !== undefined) {
      const manager = supportedManager(manifest.packageManager);
      if (manager === null) {
        warnings.push({
          code: 'PACKAGE_MANAGER_UNSUPPORTED',
          message: 'package.json declares an unsupported package manager.',
          sensorId: SENSOR_ID,
          path: 'package.json',
          affectsCompleteness: false,
        });
      } else {
        managerEvidence.set(manager, [
          addEvidence({
            id: `node.manifest.package-manager.${manager}`,
            sensorId: SENSOR_ID,
            kind: 'manifest',
            path: 'package.json',
            pointer: ['packageManager'],
            summary: `package.json declares ${manager} as its package manager.`,
          }),
        ]);
      }
    }
    for (const [lockfile, manager] of [
      ['package-lock.json', 'npm'],
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
    ] as const) {
      if (!context.inventory.files.has(lockfile)) continue;
      const item = addEvidence({
        id: `node.lockfile.${manager}`,
        sensorId: SENSOR_ID,
        kind: 'lockfile',
        path: lockfile,
        summary: `${manager} lockfile is present.`,
      });
      managerEvidence.set(manager, [...(managerEvidence.get(manager) ?? []), item]);
    }
    for (const [manager, items] of [...managerEvidence].sort(([left], [right]) =>
      compareText(left, right),
    )) {
      addCapability(`package-manager.${manager}`, 'package-manager', manager, items);
    }
    if (managerEvidence.size > 1) {
      ambiguities.push({
        code: 'PACKAGE_MANAGER_CONFLICT',
        message: 'Multiple package-manager declarations or lockfiles are present.',
        candidateIds: [...managerEvidence.keys()]
          .sort(compareText)
          .map((manager) => `package-manager.${manager}`),
        evidenceIds: [...managerEvidence.values()]
          .flat()
          .map((item) => item.id)
          .sort(compareText),
      });
    }

    const typescriptEvidence: ProjectEvidence[] = [];
    const eslintEvidence: ProjectEvidence[] = [];

    if (manifest !== null) {
      workspaceUnits.push({
        id: 'workspace.root',
        path: '.',
        ...(manifest.name === undefined ? {} : { name: manifest.name }),
        evidenceIds: ['node.manifest.package-json'],
      });

      const dependencyEvidence = (name: string): ProjectEvidence[] => {
        const sections = manifest?.dependencies.get(name) ?? [];
        return sections.map((section) =>
          addEvidence({
            id: `node.dependency.${section}.${name}`,
            sensorId: SENSOR_ID,
            kind: 'manifest',
            path: 'package.json',
            pointer: [section, name],
            summary: `package.json declares ${name} in ${section}.`,
          }),
        );
      };

      viteEvidence.push(...dependencyEvidence('vite'));
      vitestEvidence.push(...dependencyEvidence('vitest'));
      jestEvidence.push(...dependencyEvidence('jest'));
      typescriptEvidence.push(...dependencyEvidence('typescript'));
      eslintEvidence.push(...dependencyEvidence('eslint'));

      for (const [name, command] of Object.entries(manifest.scripts).sort(([left], [right]) =>
        compareText(left, right),
      )) {
        const kind = scriptKind(name);
        if (kind === null) continue;
        const item = addEvidence({
          id: `node.script.${stableSuffix(name)}.${name.replace(/[^a-zA-Z0-9]+/gu, '-')}`,
          sensorId: SENSOR_ID,
          kind: 'script',
          path: 'package.json',
          pointer: ['scripts', name],
          summary: `package.json declares the ${name} script.`,
        });
        taskCandidates.push({
          id: `task.root.${kind}.${stableSuffix(name)}`,
          kind,
          label: `${kind === 'run' ? 'Run' : kind === 'preview' ? 'Preview' : `Run ${kind}`} (${name})`,
          command,
          workingDirectory: '.',
          workspaceId: 'workspace.root',
          confidence: 'confirmed',
          evidenceIds: [item.id],
        });
        if (kind === 'test' && DIRECT_JEST_SCRIPT_PATTERN.test(command.trim())) {
          jestEvidence.push(item);
        }
        if (DIRECT_VITE_SCRIPT_PATTERN.test(command.trim())) viteEvidence.push(item);
      }
    }

    if (context.inventory.files.has('tsconfig.json')) {
      typescriptEvidence.push(
        addEvidence({
          id: 'node.config.typescript',
          sensorId: SENSOR_ID,
          kind: 'config',
          path: 'tsconfig.json',
          summary: 'TypeScript configuration is present.',
        }),
      );
    }
    if (typescriptEvidence.length > 0) {
      addCapability('language.typescript', 'language', 'TypeScript', typescriptEvidence);
      addCapability('typechecker.typescript', 'typechecker', 'TypeScript', typescriptEvidence);
    }
    if (eslintEvidence.length > 0) {
      addCapability('linter.eslint', 'linter', 'ESLint', eslintEvidence);
    }

    const testPathEvidence = [...context.inventory.files.keys()]
      .filter((path) => TEST_PATH_PATTERN.test(path))
      .sort(compareText)
      .map((path) =>
        addEvidence({
          id: `node.path.test.${stableSuffix(path)}`,
          sensorId: SENSOR_ID,
          kind: 'path',
          path,
          summary: 'A conventional JavaScript or TypeScript test path is present.',
        }),
      );

    if (context.inventory.files.has('index.html')) {
      // The root entry document is explicit machine-readable evidence, represented by the existing
      // manifest kind so a static preview can be confirmed without widening the profile contract.
      if (viteEvidence.length > 0) {
        viteEvidence.push(
          addEvidence({
            id: 'node.manifest.vite-root-index-html',
            sensorId: SENSOR_ID,
            kind: 'manifest',
            path: 'index.html',
            summary: 'Root index.html is present as the Vite entry document.',
          }),
        );
      } else if (
        context.inventory.traversalComplete &&
        (!context.inventory.files.has('package.json') || manifest !== null)
      ) {
        const rootIndexEvidence = addEvidence({
          id: 'node.manifest.static-root-index-html',
          sensorId: SENSOR_ID,
          kind: 'manifest',
          path: 'index.html',
          summary: 'Root index.html is present as a static-site entry document.',
        });
        addCapability('preview.static-html', 'preview', 'Static HTML', [rootIndexEvidence]);
      }
    }

    if (viteEvidence.length > 0) {
      addCapability('framework.vite', 'framework', 'Vite', viteEvidence);
      addCapability('build-tool.vite', 'build-tool', 'Vite', viteEvidence);
    }
    if (vitestEvidence.length > 0) {
      addCapability('test-framework.vitest', 'test-framework', 'Vitest', [
        ...vitestEvidence,
        ...testPathEvidence,
      ]);
    }
    if (jestEvidence.length > 0) {
      addCapability('test-framework.jest', 'test-framework', 'Jest', [
        ...jestEvidence,
        ...testPathEvidence,
      ]);
    }

    return {
      ...(manifest?.name === undefined ? {} : { displayName: manifest.name }),
      capabilities,
      workspaceUnits,
      taskCandidates,
      evidence,
      ambiguities,
      warnings,
    };
  }
}
