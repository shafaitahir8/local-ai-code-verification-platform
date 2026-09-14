import { createHash } from 'node:crypto';

import type {
  ProjectCapability,
  ProjectEvidence,
  ProjectProfileAmbiguity,
  ProjectProfileWarning,
  ProjectTaskCandidate,
  ProjectWorkspaceUnit,
} from '@verify/domain';

import { throwIfProjectProfileCancelled } from '../cancelled.js';
import type { ProjectSensor, ProjectSensorContext, ProjectSensorResult } from '../contracts.js';
import { compareText } from '../ordering.js';

const SENSOR_ID = 'python';
const PYTHON_TEST_PATH_PATTERN = /(?:^|\/)(?:tests?\/.*\.py|test_[^/]+\.py|[^/]+_test\.py)$/u;
const PYTEST_REQUIREMENT_PATTERN = /^pytest(?:\[[^\]]+\])?(?=\s*(?:[<>=!~;@]|$))/iu;

interface ParsedPyproject {
  readonly name?: string;
  readonly pytestSignals: readonly {
    readonly pointer: readonly string[];
    readonly summary: string;
  }[];
}

interface TomlAssignment {
  readonly key: string;
  readonly value: string;
}

function stableSuffix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === undefined) continue;
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote === null ? character : quote;
      continue;
    }
    if (character === '#' && quote === null) return line.slice(0, index);
  }
  return line;
}

function parseTomlSections(source: string): ReadonlyMap<string, readonly string[]> {
  const sections = new Map<string, string[]>();
  let section = '';
  sections.set(section, []);

  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const content = stripTomlComment(line).trim();
    if (content.length === 0) continue;

    const table = /^\[([^\][\r\n]+)\]$/u.exec(content);
    const arrayTable = /^\[\[([^\][\r\n]+)\]\]$/u.exec(content);
    if (arrayTable !== null) {
      section = arrayTable[1]?.trim() ?? '';
      if (section.length === 0) throw new Error('pyproject.toml contains an empty table name.');
      if (!sections.has(section)) sections.set(section, []);
      continue;
    }
    if (table !== null) {
      section = table[1]?.trim() ?? '';
      if (section.length === 0) throw new Error('pyproject.toml contains an empty table name.');
      if (!sections.has(section)) sections.set(section, []);
      continue;
    }
    if (content.startsWith('[')) {
      throw new Error('pyproject.toml contains an invalid table header.');
    }
    sections.get(section)?.push(content);
  }

  return sections;
}

function bracketBalance(value: string): number {
  let balance = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const character of value) {
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? null : quote === null ? character : quote;
      continue;
    }
    if (quote !== null) continue;
    if (character === '[') balance += 1;
    if (character === ']') balance -= 1;
  }
  return balance;
}

function tomlAssignments(lines: readonly string[]): readonly TomlAssignment[] {
  const result: TomlAssignment[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/u.exec(line);
    if (match === null) continue;
    const key = match[1];
    let value = match[2] ?? '';
    if (key === undefined) continue;

    if (value.trimStart().startsWith('[')) {
      let balance = bracketBalance(value);
      while (balance > 0) {
        index += 1;
        const continuation = lines[index];
        if (continuation === undefined) {
          throw new Error(`pyproject.toml contains an unterminated array for ${key}.`);
        }
        value += `\n${continuation}`;
        balance = bracketBalance(value);
      }
      if (balance !== 0) throw new Error(`pyproject.toml contains an invalid array for ${key}.`);
    }
    result.push({ key, value: value.trim() });
  }
  return result;
}

function parseTomlString(value: string, label: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') return parsed;
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  throw new Error(`pyproject.toml ${label} must be a quoted string.`);
}

function stringsFromTomlArray(value: string): readonly string[] {
  if (!value.startsWith('[') || !value.endsWith(']')) return [];
  const result: string[] = [];
  const content = value.slice(1, -1);
  let index = 0;
  const skipWhitespace = (): void => {
    while (/\s/u.test(content[index] ?? '')) index += 1;
  };

  while (index < content.length) {
    skipWhitespace();
    if (index >= content.length) break;

    const quote = content[index];
    if (quote !== '"' && quote !== "'") {
      throw new Error('pyproject.toml dependency arrays must contain only quoted strings.');
    }
    const start = index;
    index += 1;
    let escaped = false;
    while (index < content.length) {
      const character = content[index];
      if (quote === '"' && escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (quote === '"' && character === '\\') {
        escaped = true;
        index += 1;
        continue;
      }
      if (character === quote) break;
      index += 1;
    }
    if (content[index] !== quote) {
      throw new Error('pyproject.toml dependency array contains an unterminated string.');
    }
    index += 1;
    const literal = content.slice(start, index);
    result.push(quote === '"' ? parseTomlString(literal, 'dependency') : literal.slice(1, -1));

    skipWhitespace();
    if (index >= content.length) break;
    if (content[index] !== ',') {
      throw new Error('pyproject.toml dependency array entries must be comma-separated.');
    }
    index += 1;
  }
  return result;
}

function hasPytestRequirement(values: readonly string[]): boolean {
  return values.some((value) => PYTEST_REQUIREMENT_PATTERN.test(value.trim()));
}

function parsePyproject(source: string): ParsedPyproject {
  const sections = parseTomlSections(source);
  const pytestSignals: { pointer: readonly string[]; summary: string }[] = [];
  let name: string | undefined;

  const projectAssignments = tomlAssignments(sections.get('project') ?? []);
  const nameAssignment = projectAssignments.find((assignment) => assignment.key === 'name');
  if (nameAssignment !== undefined) {
    const parsedName = parseTomlString(nameAssignment.value, 'project.name').trim();
    if (parsedName.length > 0) name = parsedName;
  }
  const dependencies = projectAssignments.find((assignment) => assignment.key === 'dependencies');
  if (
    dependencies !== undefined &&
    hasPytestRequirement(stringsFromTomlArray(dependencies.value))
  ) {
    pytestSignals.push({
      pointer: ['project', 'dependencies'],
      summary: 'pyproject.toml declares pytest in project dependencies.',
    });
  }

  for (const [section, lines] of [...sections].sort(([left], [right]) =>
    compareText(left, right),
  )) {
    if (section === 'tool.pytest.ini_options') {
      pytestSignals.push({
        pointer: ['tool', 'pytest', 'ini_options'],
        summary: 'pyproject.toml contains dedicated pytest configuration.',
      });
    }

    const assignments = tomlAssignments(lines);
    const arrayDependencySection =
      section === 'project.optional-dependencies' ||
      section === 'dependency-groups' ||
      section === 'tool.uv';
    if (arrayDependencySection) {
      for (const assignment of assignments) {
        if (!hasPytestRequirement(stringsFromTomlArray(assignment.value))) continue;
        pytestSignals.push({
          pointer: [...section.split('.'), assignment.key],
          summary: `pyproject.toml declares pytest in ${section}.${assignment.key}.`,
        });
      }
    }

    if (/^tool\.poetry(?:\.group\.[^.]+)?\.(?:dev-)?dependencies$/u.test(section)) {
      if (assignments.some((assignment) => assignment.key.toLowerCase() === 'pytest')) {
        pytestSignals.push({
          pointer: [...section.split('.'), 'pytest'],
          summary: `pyproject.toml declares pytest in ${section}.`,
        });
      }
    }
  }

  return {
    ...(name === undefined ? {} : { name }),
    pytestSignals,
  };
}

function parseIniSections(source: string, path: string): ReadonlySet<string> {
  const sections = new Set<string>();
  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const content = line.trim();
    if (content.length === 0 || content.startsWith('#') || content.startsWith(';')) continue;
    const match = /^\[([^\]\r\n]+)\]\s*(?:[#;].*)?$/u.exec(content);
    if (match !== null) {
      const section = match[1]?.trim() ?? '';
      if (section.length === 0) throw new Error(`${path} contains an empty section name.`);
      sections.add(section);
      continue;
    }
    if (content.startsWith('[')) throw new Error(`${path} contains an invalid section header.`);
  }
  return sections;
}

function requirementsDeclarePytest(source: string): boolean {
  return source
    .replaceAll('\r\n', '\n')
    .split('\n')
    .some((line) => {
      const requirement = stripTomlComment(line).trim();
      return requirement.length > 0 && PYTEST_REQUIREMENT_PATTERN.test(requirement);
    });
}

export class PythonProjectSensor implements ProjectSensor {
  public readonly id = SENSOR_ID;

  public async scan(context: ProjectSensorContext): Promise<ProjectSensorResult> {
    throwIfProjectProfileCancelled(context.signal);
    const evidence: ProjectEvidence[] = [];
    const capabilities: ProjectCapability[] = [];
    const taskCandidates: ProjectTaskCandidate[] = [];
    const workspaceUnits: ProjectWorkspaceUnit[] = [];
    const ambiguities: ProjectProfileAmbiguity[] = [];
    const warnings: ProjectProfileWarning[] = [];
    const pythonEvidence: ProjectEvidence[] = [];
    const packagingEvidence: ProjectEvidence[] = [];
    const pytestEvidence: ProjectEvidence[] = [];
    let displayName: string | undefined;

    const addEvidence = (item: ProjectEvidence): ProjectEvidence => {
      evidence.push(item);
      return item;
    };

    if (context.inventory.files.has('pyproject.toml')) {
      const marker = addEvidence({
        id: 'python.manifest.pyproject-toml',
        sensorId: SENSOR_ID,
        kind: 'manifest',
        path: 'pyproject.toml',
        summary: 'Python project metadata is present in pyproject.toml.',
      });
      pythonEvidence.push(marker);
      packagingEvidence.push(marker);
      try {
        const source = await context.metadata.readText('pyproject.toml');
        if (source !== null) {
          const parsed = parsePyproject(source.text);
          displayName = parsed.name;
          for (const signal of parsed.pytestSignals) {
            const item = addEvidence({
              id: `python.pyproject.pytest.${stableSuffix(signal.pointer.join('/'))}`,
              sensorId: SENSOR_ID,
              kind: signal.pointer[0] === 'tool' ? 'config' : 'manifest',
              path: 'pyproject.toml',
              pointer: signal.pointer,
              summary: signal.summary,
            });
            pytestEvidence.push(item);
          }
        }
      } catch (error) {
        warnings.push({
          code: 'PYPROJECT_TOML_INVALID',
          message: `Could not parse pyproject.toml: ${error instanceof Error ? error.message : String(error)}`,
          sensorId: SENSOR_ID,
          path: 'pyproject.toml',
          affectsCompleteness: true,
        });
      }
    }

    throwIfProjectProfileCancelled(context.signal);
    if (context.inventory.files.has('requirements.txt')) {
      const marker = addEvidence({
        id: 'python.manifest.requirements-txt',
        sensorId: SENSOR_ID,
        kind: 'manifest',
        path: 'requirements.txt',
        summary: 'Python requirements metadata is present.',
      });
      pythonEvidence.push(marker);
      packagingEvidence.push(marker);
      const source = await context.metadata.readText('requirements.txt');
      if (source !== null && requirementsDeclarePytest(source.text)) {
        pytestEvidence.push(
          addEvidence({
            id: 'python.manifest.requirements-pytest',
            sensorId: SENSOR_ID,
            kind: 'manifest',
            path: 'requirements.txt',
            pointer: ['requirements', 'pytest'],
            summary: 'requirements.txt declares pytest as a dependency.',
          }),
        );
      }
    }

    if (context.inventory.files.has('setup.py')) {
      const marker = addEvidence({
        id: 'python.manifest.setup-py',
        sensorId: SENSOR_ID,
        kind: 'manifest',
        path: 'setup.py',
        summary: 'Python setup.py packaging metadata is present.',
      });
      pythonEvidence.push(marker);
      packagingEvidence.push(marker);
    }

    if (context.inventory.files.has('setup.cfg')) {
      const marker = addEvidence({
        id: 'python.config.setup-cfg',
        sensorId: SENSOR_ID,
        kind: 'config',
        path: 'setup.cfg',
        summary: 'Python setup.cfg packaging metadata is present.',
      });
      pythonEvidence.push(marker);
      packagingEvidence.push(marker);
      try {
        const source = await context.metadata.readText('setup.cfg');
        if (source !== null && parseIniSections(source.text, 'setup.cfg').has('tool:pytest')) {
          pytestEvidence.push(
            addEvidence({
              id: 'python.config.pytest.setup-cfg',
              sensorId: SENSOR_ID,
              kind: 'config',
              path: 'setup.cfg',
              pointer: ['tool:pytest'],
              summary: 'setup.cfg contains dedicated pytest configuration.',
            }),
          );
        }
      } catch (error) {
        warnings.push({
          code: 'PYTHON_CONFIG_INVALID',
          message: `Could not parse setup.cfg: ${error instanceof Error ? error.message : String(error)}`,
          sensorId: SENSOR_ID,
          path: 'setup.cfg',
          affectsCompleteness: true,
        });
      }
    }

    for (const path of ['.pytest.ini', 'pytest.ini', 'tox.ini']) {
      if (!context.inventory.files.has(path)) continue;
      try {
        const source = await context.metadata.readText(path);
        if (source === null) continue;
        const hasPytestSection = parseIniSections(source.text, path).has('pytest');
        if (!hasPytestSection && path === 'tox.ini') continue;
        if (!hasPytestSection) {
          throw new Error(`${path} does not contain a [pytest] section.`);
        }
        const item = addEvidence({
          id: `python.config.pytest.${stableSuffix(path)}`,
          sensorId: SENSOR_ID,
          kind: 'config',
          path,
          pointer: ['pytest'],
          summary: `${path} contains dedicated pytest configuration.`,
        });
        pythonEvidence.push(item);
        pytestEvidence.push(item);
      } catch (error) {
        warnings.push({
          code: 'PYTEST_CONFIG_INVALID',
          message: `Could not parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
          sensorId: SENSOR_ID,
          path,
          affectsCompleteness: true,
        });
      }
    }

    throwIfProjectProfileCancelled(context.signal);
    const testPathEvidence = [...context.inventory.files.keys()]
      .filter((path) => PYTHON_TEST_PATH_PATTERN.test(path))
      .sort(compareText)
      .map((path) =>
        addEvidence({
          id: `python.path.test.${stableSuffix(path)}`,
          sensorId: SENSOR_ID,
          kind: 'path',
          path,
          summary: 'A conventional Python test path is present.',
        }),
      );

    if (pythonEvidence.length > 0) {
      const evidenceIds = pythonEvidence.map((item) => item.id);
      capabilities.push({
        id: 'language.python',
        kind: 'language',
        name: 'Python',
        confidence: 'confirmed',
        evidenceIds,
      });
      capabilities.push({
        id: 'runtime.python',
        kind: 'runtime',
        name: 'Python',
        confidence: 'confirmed',
        evidenceIds,
      });
    }

    if (packagingEvidence.length > 0) {
      workspaceUnits.push({
        id: 'workspace.python.root',
        path: '.',
        ...(displayName === undefined ? {} : { name: displayName }),
        evidenceIds: packagingEvidence.map((item) => item.id),
      });
    }

    if (pytestEvidence.length > 0) {
      capabilities.push({
        id: 'test-framework.pytest',
        kind: 'test-framework',
        name: 'pytest',
        confidence: 'confirmed',
        evidenceIds: [...pytestEvidence, ...testPathEvidence].map((item) => item.id),
      });
    }

    return {
      ...(displayName === undefined ? {} : { displayName }),
      capabilities,
      workspaceUnits,
      taskCandidates,
      evidence,
      ambiguities,
      warnings,
    };
  }
}
