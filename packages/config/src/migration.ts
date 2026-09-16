import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseDocument } from 'yaml';

import {
  ConfigMigrationStaleError,
  ConfigNotFoundError,
  ConfigUnsafePathError,
  ConfigValidationError,
} from './errors.js';
import { getProjectConfigPath } from './filesystem.js';
import type {
  ConfigMigrationApplyOptions,
  ConfigMigrationApplyResult,
  ConfigMigrationPreview,
  ProjectConfigV1,
  ProjectConfigV2,
} from './types.js';
import { parseProjectConfig, parseProjectConfigV2 } from './yaml.js';

interface TextLine {
  readonly text: string;
  readonly hasEol: boolean;
}

type DiffOperation =
  | { readonly kind: 'context'; readonly line: TextLine }
  | { readonly kind: 'remove'; readonly line: TextLine }
  | { readonly kind: 'add'; readonly line: TextLine };

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function sha256(source: Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

function decodeUtf8(source: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
  } catch {
    throw new ConfigValidationError([{ path: '$', message: 'must be valid UTF-8 YAML text.' }]);
  }
}

async function readSafeSource(path: string): Promise<{ bytes: Uint8Array; mode: number }> {
  const directory = dirname(path);
  try {
    if ((await lstat(directory)).isSymbolicLink()) throw new ConfigUnsafePathError(directory);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new ConfigUnsafePathError(path);
    }
    return { bytes: await readFile(path), mode: metadata.mode & 0o777 };
  } catch (error) {
    if (isErrno(error, 'ENOENT')) throw new ConfigNotFoundError(path);
    throw error;
  }
}

function splitLines(source: string): readonly TextLine[] {
  // Keep a CR byte as part of a CRLF line so the diff represents the exact file text.
  const parts = source.split('\n');
  const hasFinalEol = source.endsWith('\n');
  if (hasFinalEol) parts.pop();
  return parts.map((text, index) => ({
    text,
    hasEol: index < parts.length - 1 || hasFinalEol,
  }));
}

function sameLine(left: TextLine, right: TextLine): boolean {
  return left.text === right.text && left.hasEol === right.hasEol;
}

function diffOperations(before: readonly TextLine[], after: readonly TextLine[]): DiffOperation[] {
  // A policy is normally short. Bound quadratic matching for an untrusted oversized YAML file;
  // the deterministic all-remove/all-add fallback still describes the exact replacement.
  if ((before.length + 1) * (after.length + 1) > 500_000) {
    return [
      ...before.map((line): DiffOperation => ({ kind: 'remove', line })),
      ...after.map((line): DiffOperation => ({ kind: 'add', line })),
    ];
  }

  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left]![right] = sameLine(before[left]!, after[right]!)
        ? 1 + table[left + 1]![right + 1]!
        : Math.max(table[left + 1]![right]!, table[left]![right + 1]!);
    }
  }

  const operations: DiffOperation[] = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && sameLine(before[left]!, after[right]!)) {
      operations.push({ kind: 'context', line: before[left]! });
      left += 1;
      right += 1;
    } else if (
      left < before.length &&
      (right >= after.length || table[left + 1]![right]! >= table[left]![right + 1]!)
    ) {
      operations.push({ kind: 'remove', line: before[left]! });
      left += 1;
    } else {
      operations.push({ kind: 'add', line: after[right]! });
      right += 1;
    }
  }
  return operations;
}

function unifiedDiff(before: string, after: string): string {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const operations = diffOperations(oldLines, newLines);
  const output = [
    '--- a/.verify/project.yml',
    '+++ b/.verify/project.yml',
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
  ];
  for (const operation of operations) {
    const prefix = operation.kind === 'context' ? ' ' : operation.kind === 'remove' ? '-' : '+';
    output.push(`${prefix}${operation.line.text}`);
    if (!operation.line.hasEol) output.push('\\ No newline at end of file');
  }
  return `${output.join('\n')}\n`;
}

function renderTargetYaml(source: string, config: ProjectConfigV1): string {
  const document = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  // The source has already passed the stricter v1 parser, including alias conversion limits.
  const quickSuites = Object.entries(config.suites)
    .filter(
      ([, suite]) => suite.type.toLowerCase() === 'test' || suite.type.toLowerCase() === 'lint',
    )
    .map(([id]) => id);
  const fullSuites = Object.keys(config.suites);

  document.set('version', 2);
  document.set('plans', {
    quick: { suites: quickSuites },
    full: { suites: fullSuites },
  });
  document.set('launch_targets', {});
  document.set('discovery', { exclusions: [] });
  document.set('overrides', {});

  const target = document.toString({ lineWidth: 0 });
  return source.includes('\r\n') && !/(^|[^\r])\n/u.test(source)
    ? target.replace(/\n/gu, '\r\n')
    : target;
}

function explainMembership(config: ProjectConfigV2): string {
  const quick = config.plans.quick.suites;
  const full = config.plans.full.suites;
  const list = (items: readonly string[]) => (items.length === 0 ? 'none' : items.join(', '));
  return `Schema v2 preserves the project and ${full.length} named suite(s). Quick proposes existing test/lint suites (${list(quick)}); Full proposes every existing suite (${list(full)}). Migration does not approve or execute commands.`;
}

function makePreview(
  path: string,
  bytes: Uint8Array,
): {
  readonly preview: ConfigMigrationPreview;
  readonly config: ProjectConfigV2;
} {
  const source = decodeUtf8(bytes);
  const v1 = parseProjectConfig(source);
  const targetYaml = renderTargetYaml(source, v1);
  const config = parseProjectConfigV2(targetYaml);
  if (
    config.project.name !== v1.project.name ||
    JSON.stringify(config.suites) !== JSON.stringify(v1.suites)
  ) {
    throw new ConfigValidationError([
      { path: '$', message: 'migration must preserve the project name and named suites.' },
    ]);
  }

  return {
    preview: {
      path,
      sourceVersion: 1,
      targetVersion: 2,
      sourceDigest: sha256(bytes),
      targetDigest: sha256(Buffer.from(targetYaml, 'utf8')),
      targetYaml,
      diff: unifiedDiff(source, targetYaml),
      summary: explainMembership(config),
    },
    config,
  };
}

export async function previewProjectConfigMigration(
  repositoryRoot: string,
): Promise<ConfigMigrationPreview> {
  const path = getProjectConfigPath(repositoryRoot);
  const source = await readSafeSource(path);
  return makePreview(path, source.bytes).preview;
}

/** Explicit compare-and-replace. No caller-provided YAML is accepted. */
export async function applyProjectConfigMigration(
  options: ConfigMigrationApplyOptions,
): Promise<ConfigMigrationApplyResult> {
  const path = getProjectConfigPath(options.repositoryRoot);
  const source = await readSafeSource(path);
  if (sha256(source.bytes) !== options.expectedSourceDigest) {
    throw new ConfigMigrationStaleError(path, 'source');
  }
  const { preview, config } = makePreview(path, source.bytes);
  if (preview.targetDigest !== options.expectedTargetDigest) {
    throw new ConfigMigrationStaleError(path, 'target');
  }

  const temporaryPath = join(dirname(path), `.project.yml.migration-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, 'wx', source.mode);
    temporaryCreated = true;
    try {
      await handle.writeFile(preview.targetYaml, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Check once more immediately before replacement, including symbolic-path safety. A changed
    // source, even one with comment-only edits, never gets overwritten by this proposal.
    const current = await readSafeSource(path);
    if (sha256(current.bytes) !== options.expectedSourceDigest) {
      throw new ConfigMigrationStaleError(path, 'source');
    }
    await rename(temporaryPath, path);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) await unlink(temporaryPath);
  }

  return {
    path,
    version: 2,
    sourceDigest: preview.sourceDigest,
    targetDigest: preview.targetDigest,
    config,
  };
}
