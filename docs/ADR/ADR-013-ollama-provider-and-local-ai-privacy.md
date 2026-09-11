# ADR-013: Introduce Local AI through an Isolated Ollama Provider

- Status: Accepted
- Date: 2026-09-11
- Applies to: Iteration 7 local AI project understanding

## Context

The first AI milestone needs a concrete local provider to validate model availability, structured
output, performance, cancellation, privacy, and user trust. Provider-specific requests must not
leak through the application, and AI must remain advisory.

## Decision

Define a `ModelProvider` port around the first real structured project-understanding workflow and
ship one Ollama adapter. The adapter connects only to an explicitly configured loopback endpoint.
It exposes availability, selected model, structured generation, timeout, and cancellation.

AI workflows and prompts are versioned. Stored assessments record provider, model, workflow
version, relevant parameters, and input profile/configuration digests. Outputs are schema-validated
and remain distinct from deterministic evidence.

Context construction uses an allowlisted, inspectable manifest of selected repository facts and
content. It excludes ignored, binary, generated, oversized, and likely secret material. It does not
dump an entire repository indiscriminately. AI cannot execute commands, mutate source, persist
configuration directly, or influence PASS/WARN/BLOCK.

If the endpoint or model is unavailable, the UI reports that condition and offers local setup or
retry guidance while deterministic profiling, planning, configured verification, history, and gates
continue unchanged. The provider layer never substitutes a cloud or non-loopback endpoint.

## Consequences

- The product continues to work when Ollama or a suitable model is unavailable.
- Live-model validation is opt-in; deterministic tests use a fake provider and fixed structured
  responses.
- Model errors, invalid output, timeout, and cancellation are explicit non-gate outcomes.
- Additional local providers can implement the same port later without changing core workflows.
- Cloud endpoints, credentials, model downloads, and an unrestricted chat or shell interface are
  out of scope for this decision.

## Alternatives considered

- Shipping Ollama and a generic OpenAI-compatible adapter together was deferred to keep the first
  provider milestone small and testable.
- Defining a provider abstraction without a concrete provider was rejected because it would not
  validate the product experience.
- Allowing remote endpoints by default was rejected because it conflicts with local/private
  expectations and expands the source-disclosure boundary.
