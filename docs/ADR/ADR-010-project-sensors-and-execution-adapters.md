# ADR-010: Separate Project Sensors from Execution Adapters

- Status: Accepted
- Date: 2026-09-11
- Applies to: Project intelligence, framework integration, and command execution

## Context

Current discovery is coupled to configuration suggestions and recognizes a small set of root
markers and package scripts. The revised roadmap needs richer project understanding for the core,
CLI, desktop, planner, and future AI. Detection must not implicitly grant authority to execute what
was detected.

## Decision

Introduce two explicit adapter roles:

- A `ProjectSensor` performs cancellable, read-only inspection and returns portable evidence-backed
  capabilities, confidence, ambiguities, and warnings.
- An execution adapter runs an operation already authorized by accepted project policy and returns
  normalized evidence through the existing verification boundaries.

Portable `ProjectProfile` records belong to the domain. Sensor coordination belongs in a dedicated
project-intelligence boundary outside `@verify/config`. Concrete ecosystem detectors remain
isolated adapters and expose common capabilities rather than framework-specific domain fields.

The coordinator constructs one bounded, read-only repository inventory. Sensors receive that
inventory, a budget-enforcing metadata reader, an `AbortSignal`, and progress reporting; they do not
receive a command runner, writer, database, network client, or unrestricted filesystem handle.
Evidence uses repository-relative paths and redacted summaries. Confidence is categorical:
`confirmed` for explicit declarations or dedicated configuration, `strong` for multiple independent
compatible signals, and `tentative` for convention-only evidence. Conflicting credible evidence is
reported as ambiguity rather than resolved by guessing.

Existing discovery output remains available as a compatibility projection while configuration
stops owning general repository intelligence.

## Consequences

- Discovering a script, tool, or entry point never causes it to run.
- Sensor failures must produce explicit warnings and cannot silently assert capabilities.
- Budget exhaustion produces an explicitly partial profile, while cancellation produces no partial
  profile terminal result.
- A tool may eventually have separate sensor and execution adapters with independent contracts and
  tests.
- Native result normalization can be added only where it provides demonstrated value; it is no
  longer the first post-MVP product milestone by itself.
- Adding the project-intelligence package requires the standard package documentation and dependency
  review.

## Alternatives considered

- Extending configuration discovery indefinitely was rejected because policy storage and repository
  understanding change for different reasons.
- Giving each framework one combined detect-and-execute adapter was rejected because detection
  would become an unsafe implicit execution capability.
