import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type {
  ProjectProfileProgress,
  ProjectProfileWarning,
  ProjectScanLimit,
} from '@verify/domain';

import { throwIfProjectProfileCancelled } from './cancelled.js';
import type {
  ProjectInventory,
  ProjectInventoryEntry,
  ProjectMetadataReader,
  ProjectScanLimits,
} from './contracts.js';
import { compareText } from './ordering.js';

export const DEFAULT_PROJECT_SCAN_LIMITS: ProjectScanLimits = {
  maxEntries: 50_000,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 16_777_216,
  maxElapsedMs: 10_000,
};

export const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'venv',
]);

export interface MutableScanState {
  entriesScanned: number;
  filesScanned: number;
  directoriesScanned: number;
  bytesRead: number;
  skippedDirectories: number;
  readonly limitsReached: Set<ProjectScanLimit>;
  readonly warnings: ProjectProfileWarning[];
}

export interface BuiltProjectInventory {
  readonly repositoryRoot: string;
  readonly inventory: ProjectInventory;
  readonly state: MutableScanState;
}

function normalizedPath(parent: string, name: string): string {
  return parent.length === 0 ? name : `${parent}/${name}`;
}

function elapsedLimitReached(
  startedAt: number,
  limits: ProjectScanLimits,
  now: () => number,
  state: MutableScanState,
): boolean {
  if (now() - startedAt < limits.maxElapsedMs) return false;
  state.limitsReached.add('elapsed-time');
  return true;
}

function progress(
  onProgress: ((progress: ProjectProfileProgress) => void) | undefined,
  state: MutableScanState,
  message: string,
): void {
  onProgress?.({
    phase: 'inventory',
    message,
    entriesScanned: state.entriesScanned,
    bytesRead: state.bytesRead,
    sensorsCompleted: 0,
    sensorCount: 0,
  });
}

export async function buildProjectInventory(options: {
  readonly repositoryRoot: string;
  readonly limits: ProjectScanLimits;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly startedAt: number;
  readonly onProgress?: (progress: ProjectProfileProgress) => void;
}): Promise<BuiltProjectInventory> {
  const repositoryRoot = await realpath(resolve(options.repositoryRoot));
  throwIfProjectProfileCancelled(options.signal);

  const rootStat = await lstat(repositoryRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`Project profile root is not a directory: ${repositoryRoot}`);
  }

  const state: MutableScanState = {
    entriesScanned: 0,
    filesScanned: 0,
    directoriesScanned: 1,
    bytesRead: 0,
    skippedDirectories: 0,
    limitsReached: new Set<ProjectScanLimit>(),
    warnings: [],
  };
  const entries: ProjectInventoryEntry[] = [];
  const pending: string[] = [''];
  progress(options.onProgress, state, 'Scanning repository files.');

  while (pending.length > 0) {
    throwIfProjectProfileCancelled(options.signal);
    if (elapsedLimitReached(options.startedAt, options.limits, options.now, state)) break;

    const directory = pending.pop() ?? '';
    const absoluteDirectory =
      directory.length === 0 ? repositoryRoot : resolve(repositoryRoot, directory);
    let children;
    try {
      children = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      state.warnings.push({
        code: 'DIRECTORY_READ_FAILED',
        message: `Could not inspect ${directory || '.'}: ${error instanceof Error ? error.message : String(error)}`,
        path: directory || '.',
        affectsCompleteness: true,
      });
      continue;
    }

    children.sort((left, right) => compareText(left.name, right.name));
    const childDirectories: string[] = [];
    for (const child of children) {
      throwIfProjectProfileCancelled(options.signal);
      if (elapsedLimitReached(options.startedAt, options.limits, options.now, state)) break;
      if (state.entriesScanned >= options.limits.maxEntries) {
        state.limitsReached.add('entries');
        break;
      }

      const path = normalizedPath(directory, child.name);
      state.entriesScanned += 1;

      if (child.isSymbolicLink()) {
        if (child.isDirectory() || !child.isFile()) state.skippedDirectories += 1;
        continue;
      }

      if (child.isDirectory()) {
        if (DEFAULT_EXCLUDED_DIRECTORIES.has(child.name)) {
          state.skippedDirectories += 1;
          continue;
        }
        state.directoriesScanned += 1;
        entries.push({ path, kind: 'directory', size: 0 });
        childDirectories.push(path);
        continue;
      }

      if (!child.isFile()) continue;
      try {
        const fileStat = await lstat(resolve(repositoryRoot, ...path.split('/')));
        throwIfProjectProfileCancelled(options.signal);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
        state.filesScanned += 1;
        entries.push({ path, kind: 'file', size: fileStat.size });
      } catch (error) {
        state.warnings.push({
          code: 'FILE_STAT_FAILED',
          message: `Could not inspect ${path}: ${error instanceof Error ? error.message : String(error)}`,
          path,
          affectsCompleteness: true,
        });
      }

      if (state.entriesScanned % 250 === 0) {
        progress(options.onProgress, state, 'Scanning repository files.');
      }
    }

    if (state.limitsReached.size > 0) break;
    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      const childDirectory = childDirectories[index];
      if (childDirectory !== undefined) pending.push(childDirectory);
    }
  }

  entries.sort((left, right) => compareText(left.path, right.path));
  const files = new Map(
    entries.filter((entry) => entry.kind === 'file').map((entry) => [entry.path, entry]),
  );
  progress(options.onProgress, state, 'Repository inventory complete.');
  return { repositoryRoot, inventory: { entries, files }, state };
}

function isContainedPath(repositoryRoot: string, absolutePath: string): boolean {
  const relation = relative(repositoryRoot, absolutePath);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function validRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes('\\') &&
    path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}

export function createProjectMetadataReader(options: {
  readonly repositoryRoot: string;
  readonly inventory: ProjectInventory;
  readonly state: MutableScanState;
  readonly limits: ProjectScanLimits;
  readonly signal: AbortSignal;
  readonly now: () => number;
  readonly startedAt: number;
}): ProjectMetadataReader {
  return {
    async readText(path) {
      throwIfProjectProfileCancelled(options.signal);
      if (!validRelativePath(path)) throw new Error(`Metadata path is not normalized: ${path}`);
      const entry = options.inventory.files.get(path);
      if (entry === undefined) return null;

      if (elapsedLimitReached(options.startedAt, options.limits, options.now, options.state)) {
        return null;
      }
      if (entry.size > options.limits.maxFileBytes) {
        options.state.limitsReached.add('file-bytes');
        options.state.warnings.push({
          code: 'METADATA_FILE_TOO_LARGE',
          message: `Skipped ${path} because it exceeds the metadata file-size limit.`,
          path,
          affectsCompleteness: true,
        });
        return null;
      }
      if (options.state.bytesRead + entry.size > options.limits.maxTotalBytes) {
        options.state.limitsReached.add('aggregate-bytes');
        options.state.warnings.push({
          code: 'METADATA_BUDGET_REACHED',
          message: `Skipped ${path} because the aggregate metadata-read limit was reached.`,
          path,
          affectsCompleteness: true,
        });
        return null;
      }

      const absolutePath = resolve(options.repositoryRoot, ...path.split('/'));
      const resolvedPath = await realpath(absolutePath);
      throwIfProjectProfileCancelled(options.signal);
      if (!isContainedPath(options.repositoryRoot, resolvedPath)) {
        throw new Error(`Metadata path resolves outside the repository: ${path}`);
      }
      const fileStat = await lstat(resolvedPath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
        throw new Error(`Metadata path is no longer a regular file: ${path}`);
      }

      const content = await readFile(resolvedPath);
      throwIfProjectProfileCancelled(options.signal);
      if (content.byteLength > options.limits.maxFileBytes) {
        options.state.limitsReached.add('file-bytes');
        options.state.warnings.push({
          code: 'METADATA_FILE_TOO_LARGE',
          message: `Skipped ${path} because it exceeds the metadata file-size limit.`,
          path,
          affectsCompleteness: true,
        });
        return null;
      }
      if (options.state.bytesRead + content.byteLength > options.limits.maxTotalBytes) {
        options.state.limitsReached.add('aggregate-bytes');
        options.state.warnings.push({
          code: 'METADATA_BUDGET_REACHED',
          message: `Skipped ${path} because the aggregate metadata-read limit was reached.`,
          path,
          affectsCompleteness: true,
        });
        return null;
      }

      options.state.bytesRead += content.byteLength;
      return { text: content.toString('utf8'), bytes: content.byteLength };
    },
  };
}
