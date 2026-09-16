export const approvalReceiptsMigration = {
  version: 2,
  name: 'approval-receipts',
  sql: `
CREATE TABLE approval_receipts (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  repository_root TEXT NOT NULL,
  policy_schema_version INTEGER NOT NULL CHECK (policy_schema_version = 2),
  digest_version INTEGER NOT NULL CHECK (digest_version = 1),
  policy_digest TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX approval_receipts_repository_history_idx
  ON approval_receipts(repository_root, row_id DESC);
CREATE UNIQUE INDEX approval_receipts_active_repository_unique
  ON approval_receipts(repository_root) WHERE revoked_at IS NULL;
`,
} as const;
