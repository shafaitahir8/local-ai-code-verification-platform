# @verify/ui

Accessible, reusable presentation primitives for Local Code Verifier interfaces.

## Purpose

- Own small React controls and status presentation shared by interface packages.
- Protect the boundary between visual semantics and verification behavior.
- Implements the UI foundation required by
  [TASK-011](../../docs/tasks/TASK-011-desktop-shell.md) and
  [ADR-001](../../docs/ADR/ADR-001-tauri-desktop.md).

## Public API

- `Button`: keyboard-native button with primary, secondary, quiet, and danger variants.
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`: semantic surface primitives.
- `StatusBadge`: icon-and-text status presentation that never relies on color alone.
- `Spinner`: decorative progress indicator; callers provide the accessible status text.
- `VisuallyHidden`: screen-reader-only content.
- `cx`: joins optional class names without owning styling policy.

## Allowed dependencies

- React as a peer dependency.
- DOM and accessibility-focused test utilities during development.

## Forbidden dependencies

- `@verify/core`, protocol transports, Git, YAML, SQLite, Tauri, Node subprocesses, or policy.
- Repository inspection, command execution, persistence, or gate calculation.

## Data owned

This package owns no persistent data. Status names are presentation tokens, not gate rules.

## Important invariants

- Interactive controls remain native keyboard-operable elements.
- Statuses include an icon and readable label.
- Callers can supply labels and descriptions without replacing semantic HTML.

## Security and privacy

The package performs no filesystem, subprocess, storage, logging, or network access. Text passed by
callers is rendered as React text and is not interpreted as HTML.

## Versioned contracts

No configuration, database, or protocol version is owned here. Public component props follow the
workspace package version.

## Testing

    pnpm --filter @verify/ui test
    pnpm --filter @verify/ui typecheck

Tests cover native control semantics and non-color status labels in jsdom.

## Examples

```tsx
import { Button, StatusBadge } from '@verify/ui';

<Button onClick={runVerification}>Run verification</Button>;
<StatusBadge status="PASS" label="Quality gate: PASS" />;
```
