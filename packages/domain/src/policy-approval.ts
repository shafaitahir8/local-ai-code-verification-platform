/** Version of the canonical executable-policy projection, independent of YAML formatting. */
export const EXECUTABLE_POLICY_DIGEST_VERSION = 1 as const;

export const POLICY_APPROVAL_STATUSES = [
  'policy-missing',
  'policy-invalid',
  'migration-required',
  'not-approved',
  'approved',
  'outdated',
  'revoked',
] as const;

export type PolicyApprovalState = (typeof POLICY_APPROVAL_STATUSES)[number];

/** The exact executable semantics reviewed together with the digest in one policy read. */
export interface ExecutablePolicyReview {
  readonly digestVersion: typeof EXECUTABLE_POLICY_DIGEST_VERSION;
  readonly policySchemaVersion: 2;
  readonly suites: readonly {
    readonly id: string;
    readonly type: string;
    readonly command: string;
    readonly failurePolicy: 'block' | 'warn';
    readonly timeoutMs: number | null;
  }[];
  readonly plans: {
    readonly quick: readonly string[];
    readonly full: readonly string[];
  };
  readonly launchTargets: Readonly<Record<string, never>>;
  readonly overrides: Readonly<Record<string, never>>;
}

export interface ApprovalReceipt {
  readonly id: string;
  readonly repositoryRoot: string;
  readonly policySchemaVersion: 2;
  readonly digestVersion: typeof EXECUTABLE_POLICY_DIGEST_VERSION;
  readonly policyDigest: string;
  readonly approvedAt: string;
  readonly revokedAt: string | null;
}

export interface PolicyApprovalStatus {
  readonly repositoryRoot: string;
  readonly policyPath: string;
  readonly policyExists: boolean;
  readonly policyVersion: 1 | 2 | null;
  readonly policyDigest: string | null;
  readonly review: ExecutablePolicyReview | null;
  readonly status: PolicyApprovalState;
  readonly receipt: ApprovalReceipt | null;
}
