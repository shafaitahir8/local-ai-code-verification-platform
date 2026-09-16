# TASK-017: Executable Policy Approval Receipts (Iteration 6 Slice 6C)

## Status

Complete. Explicit local approval, revocation, and status lookup are available for the current
schema-v2 executable policy. No plan or command execution was added.

## Goal

Let a local user explicitly approve the current executable portion of a valid schema-v2 project
policy once, retain that approval in local SQLite state, and fail closed when the executable policy
no longer matches the approved digest.

## Approval model

- The canonical repository root returned by the repository adapter is the local repository
  identity.
- A versioned SHA-256 digest covers execution-relevant schema-v2 policy only: named suite IDs,
  types, commands, failure policies, timeouts, ordered Quick/Full suite membership, and launch
  targets supported by the current schema.
- Project display name, YAML formatting, comments, discovery exclusions, and other
  presentation/non-executable data do not affect the executable-policy digest.
- Status returns a review snapshot of the exact normalized suite commands, settings, and
  Quick/Full membership hashed from the same validated policy read; a separately loaded UI policy
  cannot stand in for that snapshot when asking for approval.
- Status distinguishes a missing receipt, a current approval, an outdated approval for another
  digest, a revoked approval, and a valid version-1 policy that requires migration.
- Approval and revocation are explicit. Opening, profiling, planning, or migrating a repository
  never creates an approval receipt.
- Historical receipts remain local evidence. Revocation marks active receipts revoked instead of
  deleting them. Approving another digest supersedes the prior active receipt. If a policy later
  returns to exactly the still-active approved semantics, that same digest becomes current again;
  a revoked or superseded receipt never reauthorizes it.

## Persistence and safety

- Add an ordered, checksum-verified SQLite migration for local approval receipts while preserving
  existing projects and verification history.
- Bind every receipt to repository identity, policy schema version, digest format/version, policy
  digest, approval timestamp, and optional revocation timestamp.
- Status always recomputes the current digest from a freshly loaded, validated policy.
- Approving rereads and hashes the durable policy before persisting the receipt.
- Missing, malformed, unsupported, or version-1 policy cannot be approved.
- Receipt persistence failure leaves the repository policy unchanged and unapproved.

## Interfaces

- Core owns approval/status/revocation orchestration through narrow configuration and approval
  persistence ports.
- Protocol version 1 gains additive status, approve, and revoke methods.
- CLI gains explicit status, approve, and revoke commands with human and JSON output.
- Desktop shows Not approved, Approved, or Approval outdated, and exposes explicit Approve and
  Revoke controls. It does not show a Run Plan action.

## Non-goals

Plan execution, smart Verify Changes or Full Verification execution, launch execution, schema-v2
policy editing, AI/Ollama, Run Project, smart Run Tests, risk analysis, test generation, and any
Iteration 7 behavior.

## Acceptance

- Equivalent YAML formatting or comments produce the same executable-policy digest.
- Any suite command, type, timeout, failure policy, plan membership/order, or supported launch
  target change produces a different digest.
- Approval is bound to the canonical repository identity and current executable-policy digest.
- The reviewed command snapshot and digest are produced from the same validated policy read.
- A changed digest reports an outdated approval and cannot be treated as current.
- Explicit revocation removes current authorization while retaining receipt history.
- Revocation remains possible when the policy is missing, downgraded to version 1, or invalid;
  restoring an old policy cannot reactivate its revoked receipt.
- Migration acceptance alone leaves status unapproved.
- Malformed, unsupported, or missing policy fails closed.
- Core, protocol, CLI, and desktop expose the same normalized approval state.
- No approval workflow executes a project command or changes PASS/WARN/BLOCK.
- Existing version-1 verification, 6A planning, and 6B migration behavior remain unchanged.
- Full workspace format, lint, typecheck, tests, build, and diff checks pass before completion.
