# TASK-004: Generic Command Adapter

- Status: Complete
- Iteration: 1
- Depends on: TASK-001, TASK-002

## Goal

Implement the initial VerificationAdapter for explicitly configured local commands with working directory, controlled environment additions, live stdout/stderr, timeout, cancellation, timing, exit code, and normalized outcomes.

## Non-goals

- No arbitrary AI/remote shell, tool installation, gate decisions, or Vitest/Jest/pytest-specific parsing.
- No subprocess sandbox claim in the MVP.

## Packages affected

**@verify/verification**, **@verify/adapter-generic-command**, **@verify/domain** contracts only if required.

## Acceptance criteria

- Events distinguish output streams and preserve check/request identity.
- Success, non-zero exit, start failure, timeout, and cancellation normalize distinctly.
- Child processes run in the requested repository directory and are terminated on cancellation/timeout.
- Missing executable and internal execution errors never normalize as passed.

## Tests required

- Adapter contract tests for success, failure, missing executable, timeout, cancellation, stdout, stderr, working directory, environment additions, duration, and exit code.
- Cross-platform tests use deterministic fixture commands and no cloud/network service.
