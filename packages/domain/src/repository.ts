export type ChangedFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'untracked'
  | 'conflicted'
  | 'unknown';

export type GitFileStatus =
  | 'unmodified'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'unknown';

export interface LineStatistics {
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
  readonly known: boolean;
}

export interface ChangedFile {
  readonly path: string;
  readonly originalPath?: string;
  readonly status: ChangedFileStatus;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly stagedStatus: GitFileStatus;
  readonly unstagedStatus: GitFileStatus;
  readonly statistics: LineStatistics;
}

export type GitReferenceKind = 'branch' | 'commit' | 'unborn';

export interface GitReference {
  readonly kind: GitReferenceKind;
  readonly name: string;
  readonly oid?: string;
}

export interface RepositoryChange {
  readonly repositoryRoot: string;
  readonly branch: string | null;
  readonly head: GitReference;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly filesChanged: number;
  readonly stagedFiles: number;
  readonly unstagedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly hasUnknownStatistics: boolean;
  readonly files: readonly ChangedFile[];
}

export interface RepositoryChangeSummary {
  readonly filesChanged: number;
  readonly stagedFiles: number;
  readonly unstagedFiles: number;
  readonly additions: number;
  readonly deletions: number;
  readonly hasUnknownStatistics: boolean;
}

export function summarizeChangedFiles(files: readonly ChangedFile[]): RepositoryChangeSummary {
  let stagedFiles = 0;
  let unstagedFiles = 0;
  let additions = 0;
  let deletions = 0;
  let hasUnknownStatistics = false;

  for (const file of files) {
    stagedFiles += file.staged ? 1 : 0;
    unstagedFiles += file.unstaged ? 1 : 0;

    if (!file.statistics.known) {
      hasUnknownStatistics = true;
    }

    if (file.statistics.additions === null || file.statistics.deletions === null) {
      hasUnknownStatistics = true;
    } else {
      additions += file.statistics.additions;
      deletions += file.statistics.deletions;
    }
  }

  return {
    filesChanged: files.length,
    stagedFiles,
    unstagedFiles,
    additions,
    deletions,
    hasUnknownStatistics,
  };
}
