# ADR-006: Keep AI Out of the Deterministic MVP

- Status: Accepted
- Date: 2026-09-07
- Applies to: Iterations 0-4, release target v0.1.0

## Context

The long-term product includes local AI reasoning, but the first milestone must prove repository discovery, command orchestration, normalized evidence, quality gates, persistence, CLI behavior, and desktop equivalence. Model availability, hardware, probabilistic output, and additional security boundaries would obscure that proof.

## Decision

Iterations 0-4 contain no LLM dependency, provider, prompt workflow, chat UI, model download, or AI-driven command path. Gate decisions are deterministic. No unfinished AI package is created merely as a placeholder. The first post-MVP AI feature may explain changes and likely risks, but it remains advisory and requires its own decision and task.

## Reasons

- The application remains useful on machines with no model installed.
- Deterministic evidence and policy can be tested reliably before probabilistic features arrive.
- The MVP avoids source-disclosure, model-supply-chain, resource, and autonomous-execution risks.
- Clean ports leave room for later AI packages without contaminating stable components.

## Consequences

- The product name describes its direction, while v0.1.0 is intentionally a deterministic verifier.
- Risk assessment, intelligent planning, failure explanation, and generated tests are deferred.
- No AI observation can change PASS/WARN/BLOCK in the MVP because no AI path exists.
- Future AI work must preserve AI-disabled operation and distinguish advice from deterministic evidence.

## Alternatives considered

- Adding a minimal Ollama integration was rejected because it does not help prove the deterministic milestone and would delay it.
- Stub AI packages were rejected because speculative abstractions tend to harden before real provider and workflow requirements are known.
