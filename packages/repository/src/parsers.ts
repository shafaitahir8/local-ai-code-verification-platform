import type { ChangedFileStatus, GitFileStatus } from '@verify/domain';

import { GitParseError } from './errors.js';

export interface PorcelainBranch {
  readonly oid: string | null;
  readonly head: string | null;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
}

export interface PorcelainFileEntry {
  readonly path: string;
  readonly originalPath?: string;
  readonly status: ChangedFileStatus;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly stagedStatus: GitFileStatus;
  readonly unstagedStatus: GitFileStatus;
  readonly rawStatus: string;
}

export interface ParsedPorcelainV2 {
  readonly branch: PorcelainBranch;
  readonly files: readonly PorcelainFileEntry[];
}

export interface GitNumstatEntry {
  readonly path: string;
  readonly originalPath?: string;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
}

function fileStatus(code: string): GitFileStatus {
  switch (code) {
    case '.':
    case ' ':
      return 'unmodified';
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    default:
      return 'unknown';
  }
}

function overallStatus(
  stagedStatus: GitFileStatus,
  unstagedStatus: GitFileStatus,
  unmerged = false,
): ChangedFileStatus {
  if (unmerged || stagedStatus === 'unmerged' || unstagedStatus === 'unmerged') return 'conflicted';

  const statuses = [stagedStatus, unstagedStatus];
  if (statuses.includes('renamed')) return 'renamed';
  if (statuses.includes('copied')) return 'copied';
  if (statuses.includes('deleted')) return 'deleted';
  if (statuses.includes('added')) return 'added';
  if (statuses.includes('type-changed')) return 'type-changed';
  if (statuses.includes('modified')) return 'modified';
  return 'unknown';
}

function entryFromStatus(
  path: string,
  rawStatus: string,
  originalPath?: string,
): PorcelainFileEntry {
  if (rawStatus.length !== 2 || path.length === 0) {
    throw new GitParseError(`Malformed porcelain-v2 status record for path "${path}".`);
  }

  const stagedStatus = fileStatus(rawStatus[0] ?? '.');
  const unstagedStatus = fileStatus(rawStatus[1] ?? '.');
  return {
    path,
    ...(originalPath === undefined ? {} : { originalPath }),
    status: overallStatus(stagedStatus, unstagedStatus),
    staged: stagedStatus !== 'unmodified',
    unstaged: unstagedStatus !== 'unmodified',
    stagedStatus,
    unstagedStatus,
    rawStatus,
  };
}

function recordsFromPorcelain(output: string): string[] {
  return output.includes('\0') ? output.split('\0') : output.split(/\r?\n/u);
}

export function parsePorcelainV2(output: string): ParsedPorcelainV2 {
  const records = recordsFromPorcelain(output);
  const files: PorcelainFileEntry[] = [];
  let oid: string | null = null;
  let head: string | null = null;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    if (record.length === 0) continue;

    if (record.startsWith('# ')) {
      if (record.startsWith('# branch.oid ')) {
        oid = record.slice('# branch.oid '.length);
      } else if (record.startsWith('# branch.head ')) {
        const value = record.slice('# branch.head '.length);
        head = value === '(detached)' ? null : value;
      } else if (record.startsWith('# branch.upstream ')) {
        upstream = record.slice('# branch.upstream '.length);
      } else if (record.startsWith('# branch.ab ')) {
        const match = /^# branch\.ab \+(\d+) -(\d+)$/u.exec(record);
        if (match === null)
          throw new GitParseError(`Malformed branch divergence record: ${record}`);
        ahead = Number.parseInt(match[1] ?? '0', 10);
        behind = Number.parseInt(match[2] ?? '0', 10);
      }
      continue;
    }

    if (record.startsWith('1 ')) {
      const match = /^1 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ ([\s\S]+)$/u.exec(record);
      if (match === null)
        throw new GitParseError(`Malformed ordinary porcelain-v2 record: ${record}`);
      files.push(entryFromStatus(match[2] ?? '', match[1] ?? ''));
      continue;
    }

    if (record.startsWith('2 ')) {
      const match = /^2 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ ([\s\S]+)$/u.exec(
        record,
      );
      if (match === null)
        throw new GitParseError(`Malformed rename porcelain-v2 record: ${record}`);
      const originalPath = records[index + 1];
      if (originalPath === undefined || originalPath.length === 0) {
        throw new GitParseError(`Rename record for "${match[2] ?? ''}" has no original path.`);
      }
      index += 1;
      files.push(entryFromStatus(match[2] ?? '', match[1] ?? '', originalPath));
      continue;
    }

    if (record.startsWith('u ')) {
      const match = /^u ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ ([\s\S]+)$/u.exec(
        record,
      );
      if (match === null)
        throw new GitParseError(`Malformed unmerged porcelain-v2 record: ${record}`);
      const entry = entryFromStatus(match[2] ?? '', match[1] ?? '');
      files.push({ ...entry, status: 'conflicted' });
      continue;
    }

    if (record.startsWith('? ')) {
      const path = record.slice(2);
      if (path.length === 0) throw new GitParseError('Malformed untracked porcelain-v2 record.');
      files.push({
        path,
        status: 'untracked',
        staged: false,
        unstaged: true,
        stagedStatus: 'unmodified',
        unstagedStatus: 'unknown',
        rawStatus: '??',
      });
      continue;
    }

    if (record.startsWith('! ')) continue;

    throw new GitParseError(`Unknown porcelain-v2 record: ${record}`);
  }

  return {
    branch: {
      oid,
      head,
      ...(upstream === undefined ? {} : { upstream }),
      ahead,
      behind,
    },
    files,
  };
}

function parseLineCount(value: string, record: string): number | null {
  if (value === '-') return null;
  if (!/^\d+$/u.test(value)) throw new GitParseError(`Malformed numstat record: ${record}`);
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new GitParseError(`Unsafe numstat count: ${value}`);
  return count;
}

export function parseNumstatZ(output: string): GitNumstatEntry[] {
  const records = output.includes('\0') ? output.split('\0') : output.split(/\r?\n/u);
  const entries: GitNumstatEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? '';
    if (record.length === 0) continue;

    const match = /^([^\t]+)\t([^\t]+)\t([\s\S]*)$/u.exec(record);
    if (match === null) throw new GitParseError(`Malformed numstat record: ${record}`);

    const additions = parseLineCount(match[1] ?? '', record);
    const deletions = parseLineCount(match[2] ?? '', record);
    if ((additions === null) !== (deletions === null)) {
      throw new GitParseError(`Numstat binary markers do not match: ${record}`);
    }

    let path = match[3] ?? '';
    let originalPath: string | undefined;
    if (path.length === 0) {
      originalPath = records[index + 1];
      path = records[index + 2] ?? '';
      if (originalPath === undefined || originalPath.length === 0 || path.length === 0) {
        throw new GitParseError('Malformed renamed numstat record.');
      }
      index += 2;
    }

    entries.push({
      path,
      ...(originalPath === undefined ? {} : { originalPath }),
      additions,
      deletions,
      binary: additions === null,
    });
  }

  return entries;
}
