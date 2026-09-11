# ADR-014: Run Projects Only through Approved, Contained Launch Targets

- Status: Accepted
- Date: 2026-09-11
- Applies to: Run Project and local preview workflows

## Context

Run Project should choose a likely startup or preview strategy without requiring the user to know
the command. Launching a development server is long-lived and may expose a network listener or
spawn descendants. AI recommendations and repository metadata cannot be treated as execution
authority.

## Decision

Represent a launch as an explicit `LaunchTarget` in accepted project policy. A target includes its
command, working directory, selected workspace/package where relevant, launch kind, loopback
constraint, and lifecycle behavior. Deterministic sensors or AI may propose a target, but the core
may execute it only while the matching executable-policy digest has a current local approval
receipt.

Known launch adapters add or validate loopback binding and expose the final command before initial
approval. An unfamiliar command that cannot be constrained to loopback is rejected by the normal
flow and requires a separate explicit advanced override. Run Project never installs dependencies or
runs setup/migration commands automatically.

Project intelligence may report a root `index.html` as a static preview candidate only when it does
not conflict with stronger framework evidence. Iteration 8 supplies the contained loopback preview
implementation; Iteration 5 detection never starts a server. When multiple workspace or launch
targets remain credible, no target can be approved until the user selects one.

The core owns the launch session. It streams logs and status, accepts correlated cancellation, and
uses the existing bounded process-tree containment so Stop, app shutdown, failure, and timeout do
not leave descendants running. Ambiguous monorepos require target selection instead of guessing.

## Consequences

- Accepted unchanged targets can launch without repeated confirmation.
- The application can distinguish a running preview from a verification run; a launch does not
  produce PASS/WARN/BLOCK.
- Static-site preview, Vite, Next.js, and Python launch behavior can be added as independent adapters
  without changing the core lifecycle.
- The packaged application remains independent of Node.js, but a selected project may require its
  declared language runtime or tools; missing tools are reported explicitly.

## Alternatives considered

- Executing the highest-confidence discovered or AI-generated command immediately was rejected
  because confidence is not authorization.
- Confirming every unchanged launch was rejected because the executable-policy digest provides a
  durable approval boundary.
- Automatically installing dependencies was rejected because it mutates the selected repository and
  materially expands command and supply-chain risk.
