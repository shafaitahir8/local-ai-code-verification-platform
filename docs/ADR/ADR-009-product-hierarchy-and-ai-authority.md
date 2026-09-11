# ADR-009: Make Local AI Advisory and Deterministic Systems Authoritative

- Status: Accepted
- Date: 2026-09-11
- Applies to: Post-v0.1.0 product hierarchy and user experience

## Context

v0.1.0 proved the deterministic verification engine, native desktop delivery, cancellation,
persistence, and PASS/WARN/BLOCK gate. Its configuration-first interface exposes that foundation
but does not yet deliver the intended simple local-AI-assisted experience.

The product must become easier to use without allowing probabilistic output to execute arbitrary
commands or weaken deterministic evidence.

## Decision

Adopt this product hierarchy:

1. Local AI interprets structured evidence, explains ambiguity, and recommends actions or policy.
2. Deterministic application use cases convert accepted policy into explicit operations.
3. Execution adapters run only approved operations and normalize their evidence.
4. Deterministic policy alone produces PASS, WARN, or BLOCK.
5. The user can inspect and override important recommendations before they become executable policy.

The desktop presents simple actions first and retains the existing technical panels as evidence and
transparency beneath those actions. All deterministic workflows remain usable when AI is disabled,
unavailable, or fails.

Every future interface distinguishes three states explicitly:

- deterministic facts with evidence provenance;
- AI inference with model/workflow provenance and uncertainty;
- approved executable policy backed by reviewed configuration and local approval state.

A discovered or inferred command remains a candidate until it enters approved executable policy.
When Ollama is unavailable, the application continues deterministic profiling, planning,
verification, history, and gates, shows the unavailable state, and never silently uses a remote
provider.

## Compatibility

The v0.1.0 core, CLI, protocol methods, gate semantics, history, and configured-command workflow
remain supported. This decision changes post-v0.1.0 product emphasis; it does not replace the
deterministic engine or reinterpret existing results.

## Consequences

- AI output must be visibly distinguished from deterministic facts and gate decisions.
- AI may propose commands or configuration changes but cannot execute or persist them directly.
- Executable workflows need approval. All long-running workflows need provenance, progress,
  cancellation, and AI-disabled behavior where AI is only an enhancement.
- AI usefulness and model quality can evolve without destabilizing execution or policy.

## Alternatives considered

- Keeping configuration as the primary interface was rejected because it requires normal users to
  understand internal commands and YAML before receiving value.
- Letting AI operate a shell directly was rejected because it breaks the evidence, approval, and
  security boundaries.
