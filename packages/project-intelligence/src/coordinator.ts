import { basename } from 'node:path';

import {
  PROJECT_CAPABILITY_KINDS,
  PROJECT_EVIDENCE_KINDS,
  PROJECT_PROFILE_CONFIDENCE_LEVELS,
  PROJECT_PROFILE_VERSION,
  PROJECT_TASK_KINDS,
  type ProjectCapability,
  type ProjectEvidence,
  type ProjectProfile,
  type ProjectProfileAmbiguity,
  type ProjectProfileConfidence,
  type ProjectProfileProgress,
  type ProjectProfileResult,
  type ProjectProfileWarning,
  type ProjectTaskCandidate,
  type ProjectWorkspaceUnit,
} from '@verify/domain';

import { ProjectProfileCancelledError, throwIfProjectProfileCancelled } from './cancelled.js';
import type {
  ProjectProfiler,
  ProjectProfilerOptions,
  ProjectProfilerRequest,
  ProjectInventory,
  ProjectScanLimits,
  ProjectSensorResult,
} from './contracts.js';
import {
  buildProjectInventory,
  createProjectMetadataReader,
  DEFAULT_PROJECT_SCAN_LIMITS,
} from './inventory.js';
import { NodeProjectSensor } from './sensors/node.js';
import { PythonProjectSensor } from './sensors/python.js';
import { WorkspaceProjectSensor } from './sensors/workspaces.js';
import { compareText } from './ordering.js';

function compareById(left: { readonly id: string }, right: { readonly id: string }): number {
  return compareText(left.id, right.id);
}

function uniqueById<T extends { readonly id: string }>(items: readonly T[], label: string): T[] {
  const result = new Map<string, T>();
  for (const item of items) {
    if (item.id.trim().length === 0) throw new Error(`${label} contains an empty ID.`);
    if (result.has(item.id)) throw new Error(`${label} contains duplicate ID ${item.id}.`);
    result.set(item.id, item);
  }
  return [...result.values()];
}

function uniqueAmbiguities(
  items: readonly ProjectProfileAmbiguity[],
  label: string,
): ProjectProfileAmbiguity[] {
  const result = new Map<string, ProjectProfileAmbiguity>();
  for (const item of items) {
    if (result.has(item.code)) throw new Error(`${label} contains duplicate code ${item.code}.`);
    result.set(item.code, item);
  }
  return [...result.values()];
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertRelativePath(value: string, label: string, allowRoot = false): void {
  assertNonEmpty(value, label);
  if (allowRoot && value === '.') return;
  if (
    value.startsWith('/') ||
    /^[a-zA-Z]:/u.test(value) ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a normalized repository-relative path.`);
  }
}

function allowedConfidence(
  requested: ProjectProfileConfidence,
  items: readonly ProjectEvidence[],
): boolean {
  if (requested === 'tentative') return items.length >= 1;
  const explicit = items.some((item) =>
    ['manifest', 'config', 'lockfile', 'script'].includes(item.kind),
  );
  if (requested === 'confirmed') return explicit;
  return explicit || new Set(items.map((item) => `${item.kind}:${item.path}`)).size >= 2;
}

function validateSensorResult(
  sensorId: string,
  result: ProjectSensorResult,
  inventory: ProjectInventory,
): ProjectSensorResult {
  assertNonEmpty(sensorId, 'Sensor ID');
  if (result.displayName !== undefined) assertNonEmpty(result.displayName, 'Display name');
  const evidence = uniqueById(result.evidence, `Sensor ${sensorId} evidence`);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const inventoryPaths = new Set(inventory.entries.map((item) => item.path));
  for (const item of evidence) {
    if (item.sensorId !== sensorId) {
      throw new Error(`Sensor ${sensorId} returned evidence for another sensor.`);
    }
    if (!PROJECT_EVIDENCE_KINDS.includes(item.kind)) {
      throw new Error(`Evidence ${item.id} has an unsupported kind.`);
    }
    assertRelativePath(item.path, `Evidence ${item.id} path`);
    if (!inventoryPaths.has(item.path)) {
      throw new Error(`Evidence ${item.id} references a path outside the repository inventory.`);
    }
    assertNonEmpty(item.summary, `Evidence ${item.id} summary`);
    if (item.pointer?.some((segment) => typeof segment !== 'string' || segment.length === 0)) {
      throw new Error(`Evidence ${item.id} has an invalid structured pointer.`);
    }
  }

  const requireEvidence = (
    label: string,
    confidence: ProjectProfileConfidence | null,
    evidenceIds: readonly string[],
  ): void => {
    if (evidenceIds.length === 0) throw new Error(`${label} has no supporting evidence.`);
    const supporting = evidenceIds.map((id) => {
      const item = evidenceById.get(id);
      if (item === undefined) throw new Error(`${label} references unknown evidence ${id}.`);
      return item;
    });
    if (confidence !== null && !allowedConfidence(confidence, supporting)) {
      throw new Error(`${label} confidence exceeds its supporting evidence.`);
    }
  };

  const capabilities = uniqueById(result.capabilities, `Sensor ${sensorId} capabilities`);
  const workspaceUnits = uniqueById(result.workspaceUnits, `Sensor ${sensorId} workspace units`);
  const taskCandidates = uniqueById(result.taskCandidates, `Sensor ${sensorId} task candidates`);
  for (const item of capabilities) {
    if (!PROJECT_CAPABILITY_KINDS.includes(item.kind)) {
      throw new Error(`Capability ${item.id} has an unsupported kind.`);
    }
    if (!PROJECT_PROFILE_CONFIDENCE_LEVELS.includes(item.confidence)) {
      throw new Error(`Capability ${item.id} has an unsupported confidence.`);
    }
    assertNonEmpty(item.name, `Capability ${item.id} name`);
    requireEvidence(`Capability ${item.id}`, item.confidence, item.evidenceIds);
  }
  for (const item of workspaceUnits) {
    assertRelativePath(item.path, `Workspace ${item.id} path`, true);
    if (item.name !== undefined) assertNonEmpty(item.name, `Workspace ${item.id} name`);
    requireEvidence(`Workspace ${item.id}`, null, item.evidenceIds);
  }
  const workspaceIds = new Set(workspaceUnits.map((item) => item.id));
  for (const item of taskCandidates) {
    if (!PROJECT_TASK_KINDS.includes(item.kind)) {
      throw new Error(`Task ${item.id} has an unsupported kind.`);
    }
    if (!PROJECT_PROFILE_CONFIDENCE_LEVELS.includes(item.confidence)) {
      throw new Error(`Task ${item.id} has an unsupported confidence.`);
    }
    assertNonEmpty(item.label, `Task ${item.id} label`);
    assertNonEmpty(item.command, `Task ${item.id} observed command`);
    assertRelativePath(item.workingDirectory, `Task ${item.id} working directory`, true);
    requireEvidence(`Task ${item.id}`, item.confidence, item.evidenceIds);
    if (item.workspaceId !== undefined && !workspaceIds.has(item.workspaceId)) {
      throw new Error(`Task ${item.id} references unknown workspace ${item.workspaceId}.`);
    }
  }
  const candidateIds = new Set([
    ...capabilities.map((item) => item.id),
    ...workspaceUnits.map((item) => item.id),
    ...taskCandidates.map((item) => item.id),
  ]);
  const ambiguities = uniqueAmbiguities(result.ambiguities, `Sensor ${sensorId} ambiguities`);
  for (const ambiguity of ambiguities) {
    assertNonEmpty(ambiguity.code, 'Ambiguity code');
    assertNonEmpty(ambiguity.message, `Ambiguity ${ambiguity.code} message`);
    if (ambiguity.candidateIds.length === 0) {
      throw new Error(`Ambiguity ${ambiguity.code} has no candidates.`);
    }
    for (const candidateId of ambiguity.candidateIds) {
      if (!candidateIds.has(candidateId)) {
        throw new Error(`Ambiguity ${ambiguity.code} references unknown candidate ${candidateId}.`);
      }
    }
    requireEvidence(`Ambiguity ${ambiguity.code}`, null, ambiguity.evidenceIds);
  }
  for (const warning of result.warnings) {
    assertNonEmpty(warning.code, 'Warning code');
    assertNonEmpty(warning.message, `Warning ${warning.code} message`);
    if (warning.sensorId !== undefined && warning.sensorId !== sensorId) {
      throw new Error(`Sensor ${sensorId} returned a warning for another sensor.`);
    }
    if (warning.path !== undefined) {
      assertRelativePath(warning.path, `Warning ${warning.code} path`, true);
    }
    if (typeof warning.affectsCompleteness !== 'boolean') {
      throw new Error(`Warning ${warning.code} must declare whether completeness is affected.`);
    }
  }

  return {
    ...(result.displayName === undefined ? {} : { displayName: result.displayName }),
    capabilities,
    workspaceUnits,
    taskCandidates,
    evidence,
    ambiguities,
    warnings: result.warnings,
  };
}

function targetAmbiguity(
  code: string,
  message: string,
  candidates: readonly { readonly id: string; readonly evidenceIds: readonly string[] }[],
): ProjectProfileAmbiguity | null {
  if (candidates.length < 2) return null;
  return {
    code,
    message,
    candidateIds: candidates.map((candidate) => candidate.id).sort(compareText),
    evidenceIds: [...new Set(candidates.flatMap((candidate) => candidate.evidenceIds))].sort(
      compareText,
    ),
  };
}

function deriveTargetAmbiguities(
  capabilities: ReadonlyMap<string, ProjectCapability>,
  taskCandidates: ReadonlyMap<string, ProjectTaskCandidate>,
): ProjectProfileAmbiguity[] {
  const testFrameworks = [...capabilities.values()].filter(
    (capability) => capability.kind === 'test-framework',
  );
  const testTasks = [...taskCandidates.values()].filter((task) => task.kind === 'test');
  const runTasks = [...taskCandidates.values()].filter(
    (task) => task.kind === 'run' || task.kind === 'preview',
  );
  return [
    targetAmbiguity(
      'MULTIPLE_TEST_FRAMEWORKS',
      'Multiple evidence-backed test frameworks are present; no default framework was selected.',
      testFrameworks,
    ),
    targetAmbiguity(
      'MULTIPLE_TEST_TARGETS',
      'Multiple evidence-backed test commands are present; no default test target was selected.',
      testTasks,
    ),
    targetAmbiguity(
      'MULTIPLE_RUN_TARGETS',
      'Multiple evidence-backed run or preview commands are present; no default launch target was selected.',
      runTasks,
    ),
  ].filter((ambiguity): ambiguity is ProjectProfileAmbiguity => ambiguity !== null);
}

function mergeUnique<T extends { readonly id: string }>(
  target: Map<string, T>,
  items: readonly T[],
): void {
  for (const item of items) {
    if (target.has(item.id)) throw new Error(`Duplicate project-profile ID ${item.id}.`);
    target.set(item.id, item);
  }
}

function assertMergeIsAtomic<T extends { readonly id: string }>(
  target: ReadonlyMap<string, T>,
  items: readonly T[],
): void {
  for (const item of items) {
    if (target.has(item.id)) throw new Error(`Duplicate project-profile ID ${item.id}.`);
  }
}

function progress(
  request: ProjectProfilerRequest,
  state: { readonly entriesScanned: number; readonly bytesRead: number },
  phase: ProjectProfileProgress['phase'],
  message: string,
  sensorsCompleted: number,
  sensorCount: number,
): void {
  request.onProgress?.({
    phase,
    message,
    entriesScanned: state.entriesScanned,
    bytesRead: state.bytesRead,
    sensorsCompleted,
    sensorCount,
  });
}

export class FileSystemProjectProfiler implements ProjectProfiler {
  readonly #sensors;
  readonly #limits: ProjectScanLimits;
  readonly #now: () => number;
  readonly #generatedAt: () => Date;

  public constructor(options: ProjectProfilerOptions = {}) {
    this.#sensors = options.sensors ?? [
      new NodeProjectSensor(),
      new PythonProjectSensor(),
      new WorkspaceProjectSensor(),
    ];
    this.#limits = { ...DEFAULT_PROJECT_SCAN_LIMITS, ...options.limits };
    for (const [name, value] of Object.entries(this.#limits)) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Project scan limit ${name} must be a non-negative finite number.`);
      }
    }
    this.#now = options.now ?? Date.now;
    this.#generatedAt = options.generatedAt ?? (() => new Date());
  }

  public async profile(request: ProjectProfilerRequest): Promise<ProjectProfileResult> {
    const controller = request.signal === undefined ? new AbortController() : null;
    const signal = request.signal ?? controller?.signal;
    if (signal === undefined)
      throw new Error('Project profiler could not create a cancellation signal.');
    const startedAt = this.#now();

    try {
      throwIfProjectProfileCancelled(signal);
      const built = await buildProjectInventory({
        repositoryRoot: request.repositoryRoot,
        limits: this.#limits,
        signal,
        now: this.#now,
        startedAt,
        onProgress: request.onProgress,
      });
      const metadata = createProjectMetadataReader({
        repositoryRoot: built.repositoryRoot,
        inventory: built.inventory,
        state: built.state,
        limits: this.#limits,
        signal,
        now: this.#now,
        startedAt,
      });
      const capabilities = new Map<string, ProjectCapability>();
      const workspaceUnits = new Map<string, ProjectWorkspaceUnit>();
      const taskCandidates = new Map<string, ProjectTaskCandidate>();
      const evidence = new Map<string, ProjectEvidence>();
      const ambiguities = new Map<string, ProjectProfileAmbiguity>();
      const warnings: ProjectProfileWarning[] = built.state.warnings;
      let displayName: string | undefined;

      for (let index = 0; index < this.#sensors.length; index += 1) {
        throwIfProjectProfileCancelled(signal);
        const sensor = this.#sensors[index];
        if (sensor === undefined) continue;
        progress(
          request,
          built.state,
          'sensors',
          `Inspecting project metadata with ${sensor.id}.`,
          index,
          this.#sensors.length,
        );
        try {
          const result = validateSensorResult(
            sensor.id,
            await sensor.scan({
              repositoryRoot: built.repositoryRoot,
              inventory: built.inventory,
              metadata,
              signal,
              onProgress: request.onProgress,
            }),
            built.inventory,
          );
          assertMergeIsAtomic(evidence, result.evidence);
          assertMergeIsAtomic(capabilities, result.capabilities);
          assertMergeIsAtomic(workspaceUnits, result.workspaceUnits);
          assertMergeIsAtomic(taskCandidates, result.taskCandidates);
          for (const ambiguity of result.ambiguities) {
            if (ambiguities.has(ambiguity.code)) {
              throw new Error(`Duplicate project-profile ambiguity code ${ambiguity.code}.`);
            }
          }
          mergeUnique(evidence, result.evidence);
          mergeUnique(capabilities, result.capabilities);
          mergeUnique(workspaceUnits, result.workspaceUnits);
          mergeUnique(taskCandidates, result.taskCandidates);
          for (const ambiguity of result.ambiguities) ambiguities.set(ambiguity.code, ambiguity);
          warnings.push(...result.warnings);
          displayName ??= result.displayName;
        } catch (error) {
          if (error instanceof ProjectProfileCancelledError || signal.aborted) throw error;
          warnings.push({
            code: 'SENSOR_FAILED',
            message: `Sensor ${sensor.id} failed: ${error instanceof Error ? error.message : String(error)}`,
            sensorId: sensor.id,
            affectsCompleteness: true,
          });
        }
        progress(
          request,
          built.state,
          'sensors',
          `Completed project sensor ${sensor.id}.`,
          index + 1,
          this.#sensors.length,
        );
      }

      throwIfProjectProfileCancelled(signal);
      progress(
        request,
        built.state,
        'finalizing',
        'Finalizing deterministic project profile.',
        this.#sensors.length,
        this.#sensors.length,
      );
      const elapsedMs = Math.max(0, this.#now() - startedAt);
      if (elapsedMs >= this.#limits.maxElapsedMs) {
        built.state.limitsReached.add('elapsed-time');
      }
      const limitsReached = [...built.state.limitsReached].sort();
      for (const limit of limitsReached) {
        warnings.push({
          code: 'SCAN_LIMIT_REACHED',
          message: `Project profiling reached the ${limit} scan limit.`,
          affectsCompleteness: true,
        });
      }
      for (const derived of deriveTargetAmbiguities(capabilities, taskCandidates)) {
        const existing = ambiguities.get(derived.code);
        ambiguities.set(
          derived.code,
          existing === undefined
            ? derived
            : {
                ...derived,
                candidateIds: [
                  ...new Set([...existing.candidateIds, ...derived.candidateIds]),
                ].sort(compareText),
                evidenceIds: [...new Set([...existing.evidenceIds, ...derived.evidenceIds])].sort(
                  compareText,
                ),
              },
        );
      }
      const profile: ProjectProfile = {
        profileVersion: PROJECT_PROFILE_VERSION,
        repositoryRoot: built.repositoryRoot,
        displayName: displayName ?? (basename(built.repositoryRoot) || 'project'),
        generatedAt: this.#generatedAt().toISOString(),
        completeness:
          limitsReached.length > 0 || warnings.some((warning) => warning.affectsCompleteness)
            ? 'partial'
            : 'complete',
        scan: {
          entriesScanned: built.state.entriesScanned,
          filesScanned: built.state.filesScanned,
          directoriesScanned: built.state.directoriesScanned,
          bytesRead: built.state.bytesRead,
          skippedDirectories: built.state.skippedDirectories,
          elapsedMs,
          limitsReached,
        },
        capabilities: [...capabilities.values()].sort(compareById),
        workspaceUnits: [...workspaceUnits.values()].sort(compareById),
        taskCandidates: [...taskCandidates.values()].sort(compareById),
        evidence: [...evidence.values()].sort(compareById),
        ambiguities: [...ambiguities.values()].sort((left, right) =>
          compareText(left.code, right.code),
        ),
        warnings: warnings.sort((left, right) => {
          const code = compareText(left.code, right.code);
          return code === 0 ? compareText(left.message, right.message) : code;
        }),
      };
      return { status: 'completed', profile };
    } catch (error) {
      if (error instanceof ProjectProfileCancelledError || signal.aborted) {
        return { status: 'cancelled' };
      }
      throw error;
    }
  }
}

export function createProjectProfiler(options?: ProjectProfilerOptions): ProjectProfiler {
  return new FileSystemProjectProfiler(options);
}
