# TASK-003: Project Configuration and Discovery Suggestions

- Status: Complete
- Iteration: 1 and 3
- Depends on: TASK-001, TASK-002

## Goal

Own schema version 1 of **.verify/project.yml**, including YAML parsing, actionable validation, safe initialization, defaults, and suggestions derived from proven Node/Python project signals.

## Non-goals

- No command execution, gate evaluation, rich framework adapters, or silent configuration writes.
- No invented commands when project metadata does not declare them.

## Packages affected

**@verify/config**, **@verify/repository** discovery services, and their tests.

## Acceptance criteria

- Schema requires version 1, project name, and valid named suites with type, command, and failure_policy.
- Invalid paths identify the exact field, such as **suites.test.command**.
- Initialization does not overwrite existing configuration unless force is explicit.
- Discovery recognizes required marker files and package-manager/script evidence and proposes test/lint/typecheck/build suites only when supported.

## Tests required

- Valid/invalid YAML, unknown version, defaults, and error-path unit tests.
- Existing-file/force behavior tests.
- Table-driven Node, Python, mixed, and uncertain discovery fixtures.
