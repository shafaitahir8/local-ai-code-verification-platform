# TASK-012: Desktop Verification Dashboard

- Status: Implemented; native validation pending platform prerequisites
- Iteration: 4
- Depends on: TASK-011

## Goal

Deliver the minimal engineering dashboard for repository selection, discovery, change inspection, configuration initialization/review, live verification, final gate details, check results, and recent history.

## Non-goals

- No AI/chat UI, config authoring suite, diff editor, advanced charts, risk score, native framework results, or settings sprawl.

## Packages affected

**@verify/desktop**, **@verify/ui**, with no changes to core behavior solely for presentation.

## Acceptance criteria

- First launch guides Open Project -> Inspect -> Initialize if needed -> Review Checks -> Run.
- Live output and check state derive from protocol events; final PASS/WARN/BLOCK derives from the core result.
- Recent persisted runs can be opened and distinguished from the active run.
- All actions are keyboard reachable, focus is restored after dialogs, status includes text/icon semantics, logs are readable, and reduced-motion/high-contrast behavior is respected.
- CLI and desktop paths produce equivalent normalized outcomes for the same repository and config.

## Tests required

- Component tests for empty, loading, running, PASS, WARN, BLOCK, error, and history states.
- Automated accessibility tests plus keyboard/focus scenarios.
- GUI/core equivalence integration test and native first-launch smoke test.
