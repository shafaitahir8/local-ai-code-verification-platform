import { describe, expect, it } from 'vitest';

import {
  isTerminalCheckStatus,
  isUnsuccessfulCheckStatus,
  summarizeChangedFiles,
  summarizeCheckResults,
  VERIFICATION_CHECK_STATUSES,
} from '../src/index.js';
import type { ChangedFile, VerificationCheckResult } from '../src/index.js';

function result(status: VerificationCheckResult['status']): VerificationCheckResult {
  return {
    id: status,
    name: status,
    type: 'test',
    failurePolicy: 'block',
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1_000,
    findings: [],
    artifacts: [],
  };
}

describe('verification domain transformations', () => {
  it('counts every normalized result status without changing the input', () => {
    const results = VERIFICATION_CHECK_STATUSES.map(result);

    expect(summarizeCheckResults(results)).toEqual({
      total: 6,
      passed: 1,
      warning: 1,
      failed: 1,
      error: 1,
      cancelled: 1,
      skipped: 1,
    });
    expect(results.map(({ status }) => status)).toEqual(VERIFICATION_CHECK_STATUSES);
  });

  it('classifies terminal and unsuccessful statuses explicitly', () => {
    for (const status of VERIFICATION_CHECK_STATUSES) {
      expect(isTerminalCheckStatus(status)).toBe(true);
    }

    expect(isUnsuccessfulCheckStatus('failed')).toBe(true);
    expect(isUnsuccessfulCheckStatus('error')).toBe(true);
    expect(isUnsuccessfulCheckStatus('cancelled')).toBe(true);
    expect(isUnsuccessfulCheckStatus('warning')).toBe(false);
    expect(isUnsuccessfulCheckStatus('skipped')).toBe(false);
    expect(isUnsuccessfulCheckStatus('passed')).toBe(false);
  });
});

describe('repository domain transformations', () => {
  it('aggregates known line statistics and retains explicit uncertainty', () => {
    const files: ChangedFile[] = [
      {
        path: 'src/index.ts',
        status: 'modified',
        staged: true,
        unstaged: false,
        stagedStatus: 'modified',
        unstagedStatus: 'unmodified',
        statistics: { additions: 8, deletions: 3, binary: false, known: true },
      },
      {
        path: 'asset.png',
        status: 'untracked',
        staged: false,
        unstaged: true,
        stagedStatus: 'unmodified',
        unstagedStatus: 'unknown',
        statistics: { additions: null, deletions: null, binary: true, known: false },
      },
    ];

    expect(summarizeChangedFiles(files)).toEqual({
      filesChanged: 2,
      stagedFiles: 1,
      unstagedFiles: 1,
      additions: 8,
      deletions: 3,
      hasUnknownStatistics: true,
    });
  });

  it('distinguishes a known zero-line change from an unknown change', () => {
    const file: ChangedFile = {
      path: 'script.sh',
      status: 'type-changed',
      staged: true,
      unstaged: false,
      stagedStatus: 'type-changed',
      unstagedStatus: 'unmodified',
      statistics: { additions: 0, deletions: 0, binary: false, known: true },
    };

    expect(summarizeChangedFiles([file])).toMatchObject({
      additions: 0,
      deletions: 0,
      hasUnknownStatistics: false,
    });
  });
});
