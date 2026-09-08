# TASK-010: Fixtures and Integration Workflows

- Status: Complete
- Iteration: 0-4
- Depends on: TASK-003 through TASK-009

## Goal

Create real small fixture repositories and integration tests that prove the deterministic init, inspect, run, persistence, and gate workflow across PASS, WARN, and BLOCK cases.

## Non-goals

- No large simulated repository, network service, AI evaluation, native framework adapter, or production credential/data fixture.

## Packages affected

**fixtures/basic-pass**, **fixtures/failing-test**, **fixtures/failing-build**, **fixtures/git-changes**, CLI/core integration tests, and test utilities.

## Acceptance criteria

- Fixtures are minimal, deterministic, documented, and safe to copy into temporary Git repositories.
- Workflow covers init -> inspect -> run -> gate and verifies stored history.
- Breaking a test produces BLOCK; fixing it and rerunning produces PASS.
- A warn-policy failure produces WARN with exit code 0.
- Integration tests execute real Git and real child processes rather than mocking all boundaries.

## Tests required

- Fixture validation tests.
- End-to-end CLI human/JSON tests for PASS, WARN, BLOCK, invalid config, and interruption/error paths.
- Persistence reopen and latest-gate assertions.
