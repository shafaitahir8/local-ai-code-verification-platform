import { describe, expect, it } from 'vitest';

import { EXECUTABLE_POLICY_DIGEST_VERSION, POLICY_APPROVAL_STATUSES } from '../src/index.js';
import type { ApprovalReceipt, PolicyApprovalStatus } from '../src/index.js';

describe('policy approval contract', () => {
  it('keeps digest version and authorization states explicit', () => {
    expect(EXECUTABLE_POLICY_DIGEST_VERSION).toBe(1);
    expect(POLICY_APPROVAL_STATUSES).toEqual([
      'policy-missing',
      'policy-invalid',
      'migration-required',
      'not-approved',
      'approved',
      'outdated',
      'revoked',
    ]);
  });

  it('keeps a local receipt separate from portable project policy', () => {
    const receipt: ApprovalReceipt = {
      id: 'receipt-1',
      repositoryRoot: '/repo',
      policySchemaVersion: 2,
      digestVersion: 1,
      policyDigest: 'a'.repeat(64),
      approvedAt: '2026-09-16T00:00:00.000Z',
      revokedAt: null,
    };
    const status: PolicyApprovalStatus = {
      repositoryRoot: '/repo',
      policyPath: '/repo/.verify/project.yml',
      policyExists: true,
      policyVersion: 2,
      policyDigest: receipt.policyDigest,
      review: {
        digestVersion: 1,
        policySchemaVersion: 2,
        suites: [
          {
            id: 'test',
            type: 'test',
            command: 'npm test',
            failurePolicy: 'block',
            timeoutMs: null,
          },
        ],
        plans: { quick: ['test'], full: ['test'] },
        launchTargets: {},
        overrides: {},
      },
      status: 'approved',
      receipt,
    };
    expect(status.receipt).toEqual(receipt);
    expect(status).not.toHaveProperty('canExecute');
  });
});
