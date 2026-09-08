# Local-First AI Code Verification Platform

**Document Status:** Working Draft
**Version:** 0.2
**Purpose:** Product definition, technical architecture, AI architecture, development methodology, testing boundaries, GUI direction, local-model strategy, agent integration, security model, MVP definition, and modular implementation roadmap.

---

# 1. Product Vision

The application is a **local-first software verification platform designed to sit between code changes and deployment**.

Its purpose is not to replace existing testing frameworks.

Instead, it will:

1. Understand what changed in a codebase.
2. Determine the likely blast radius of those changes.
3. Assess the risk of the change.
4. Determine which existing tests and audits should run.
5. Execute deterministic testing and analysis tools.
6. Identify areas where testing is missing.
7. Use a local AI model to reason about the change and testing evidence.
8. Generate additional tests when appropriate.
9. Investigate failures.
10. Produce a clear release recommendation:
   - PASS
   - WARN
   - BLOCK
11. Make the same verification workflow available to:
   - humans through a GUI;
   - developers through a CLI;
   - CI/CD;
   - AI coding agents;
   - eventually MCP clients and enterprise systems.

The core positioning should be:

> **A private verification layer for human- and AI-written code.**

The company does not have to send proprietary source code to an external AI provider. AI inference can happen on developer hardware or infrastructure controlled by the company.

---

# 2. Product Boundary

A major principle of this project is:

> **Do not rebuild mature testing tools. Orchestrate them.**

The product should not attempt to become another Jest, pytest, Playwright, Cypress, SonarQube, Semgrep, Postman, or k6.

Our product's value comes from **understanding when and why those tools should run and combining their evidence into one verification decision**.

---

# 3. Three-Layer Verification Model

## Layer A — Deterministic Verification

This layer must work without an LLM.

Supported verification categories should eventually include:

| Category | Example tools |
|---|---|
| Unit testing | Vitest, Jest, pytest, JUnit, NUnit |
| Integration testing | existing repository suites, Testcontainers workflows |
| Browser/E2E | Playwright, Cypress, Selenium |
| API testing | existing test suites, Postman/Newman |
| Type checking | TypeScript, mypy, language compilers |
| Linting | ESLint, Ruff, Stylelint |
| Static security | Semgrep, CodeQL adapters |
| Dependency analysis | language/package-specific scanners |
| Secret detection | security scanners |
| Accessibility | axe integrations, Cypress/Playwright workflows |
| Performance | k6 |
| Build verification | actual production build commands |
| Coverage | Istanbul, coverage.py, JaCoCo, etc. |
| Custom checks | organization-defined shell commands |

The product normalizes outputs into a common internal finding format.

Important interchange formats include:

- JUnit XML
- SARIF
- JSON
- LCOV
- process exit codes

---

# 4. Layer B — Intelligent Test Planning

Instead of blindly running every test after every change, the system should determine:

- what files changed;
- what symbols changed;
- which modules depend on them;
- which tests currently cover them;
- which business-critical workflows depend upon them;
- whether the change is security-sensitive;
- which tests should therefore run;
- whether existing testing appears insufficient.

Example:

An authentication session module changes.

The platform identifies dependencies from:

- login;
- password reset;
- authenticated checkout;
- account management;
- API authorization.

It might then create:

**Required**
- authentication unit tests;
- login E2E test;
- authenticated checkout E2E test;
- authorization security rules.

**Recommended**
- session-expiry regression;
- password-reset session invalidation.

---

# 5. Layer C — AI Verification

Local AI performs reasoning that deterministic tools cannot reliably provide.

Potential responsibilities include:

- understanding the intent of a code change;
- determining whether implementation matches intent;
- identifying edge cases;
- recognizing potentially incorrect assumptions;
- identifying suspicious error handling;
- finding missing validation;
- detecting changed behavior with unchanged tests;
- identifying tests that have been weakened;
- identifying permissions/authentication concerns;
- investigating failing tests;
- recommending additional tests;
- writing proposed regression tests;
- interpreting test output;
- synthesizing verification evidence.

AI findings should initially be **advisory**.

The deterministic Quality Gate remains authoritative unless an organization explicitly promotes selected AI policies to blocking status.

---

# 6. Verification Modes

## Quick Verify

Designed to run frequently during development.

Potential actions:

- inspect current Git diff;
- run linting;
- run relevant type checking;
- run directly affected tests;
- perform change-risk analysis;
- run security rules relevant to changed code;
- AI review of the change.

## Full Verify

Designed for PRs, commits, or pre-release checks.

Potential actions:

- complete configured regression suites;
- production build;
- complete security checks;
- configured browser/API testing;
- coverage checks;
- Quality Gate evaluation.

## Deep Audit

Designed for periodic or manually requested analysis.

Potential actions:

- repository-wide architecture analysis;
- security review;
- test coverage gap analysis;
- duplication/maintainability checks;
- dependency review;
- accessibility;
- performance;
- repository hygiene;
- AI architectural observations;
- identification of high-risk areas with weak testing.

---

# 7. Change Risk Engine

Risk should be a core product concept.

Potential levels:

- LOW
- MEDIUM
- HIGH
- CRITICAL

Potential inputs:

- Git diff size;
- files changed;
- symbols changed;
- dependency fan-out;
- whether code is shared;
- test coverage;
- business-critical configuration;
- security-sensitive paths;
- authentication/authorization code;
- payment logic;
- database schema changes;
- deployment/infrastructure code;
- dependency changes;
- historical test failures;
- historical incidents;
- AI assessment.

Example configuration:

```yaml
critical_areas:
  - path: src/auth/**
    risk: critical

  - path: src/payments/**
    risk: critical

  - path: infrastructure/**
    risk: high
```

Risk controls the verification depth required.

---

# 8. Project Configuration and Test Cases

The application must not force organizations to migrate their testing into our GUI.

The repository remains the source of truth.

Proposed configuration:

```text
.verify/project.yml
```

Example:

```yaml
version: 1

project:
  name: storefront

critical_areas:
  - path: src/auth/**
    risk: critical

  - path: src/payments/**
    risk: critical

suites:
  unit:
    type: unit
    command: npm test

  e2e:
    type: e2e
    command: npx playwright test

  security:
    type: security
    command: semgrep scan

requirements:
  authenticated_checkout:
    description: >
      A logged-in user must be able to complete checkout
      without being asked to authenticate again.

    relates_to:
      - src/auth/**
      - src/checkout/**

    tests:
      - tests/e2e/checkout-authenticated.spec.ts

    failure_policy: block
```

This configuration is:

- editable by humans;
- editable through GUI;
- understandable by AI agents;
- usable from CLI;
- version-controlled;
- auditable;
- usable in CI.

---

# 9. Three Ways to Define Requirements

## GUI Requirement Builder

Fields:

- requirement name;
- expected behavior;
- affected area;
- relevant source paths;
- existing tests;
- desired test type;
- severity;
- failure behavior.

## Natural-Language Requirement Creation

Example:

> Whenever anyone modifies authentication or checkout, verify that a user who is already authenticated can complete checkout without being asked to log in again.

The AI converts this into structured configuration for human approval.

## Configuration-as-Code

Advanced teams directly edit `.verify/project.yml`.

All three approaches use the same schema.

---

# 10. Supporting Large Codebases

The application must not dump an entire repository into the LLM context.

Instead:

```text
Repository
    ↓
File index
    ↓
Syntax / symbols
    ↓
Imports and references
    ↓
Dependency graph
    ↓
Test relationships
    ↓
Git history
    ↓
Business requirements
    ↓
Risk metadata
```

Tree-sitter should provide the first parsing layer.

Language Server Protocol information can later supplement Tree-sitter when deeper semantic resolution is required.

The AI receives only relevant retrieved context.

---

# 11. GUI Philosophy

The application should not primarily look like ChatGPT.

The main interface should resemble:

- testing dashboard;
- Git diff viewer;
- quality/security dashboard;
- release readiness screen.

AI chat is a secondary side panel.

Primary interaction:

> **Run Verification**

rather than:

> **Ask AI**

---

# 12. Main Dashboard

```text
┌──────────────────────────────────────────────────────────────┐
│ Project: storefront                 Branch: feature/login    │
│ Local AI: Connected ●               Hardware: Healthy        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                       READY FOR MERGE                        │
│                            PASS                              │
│                                                              │
│ Risk: MEDIUM      18 checks passed      2 recommendations   │
├───────────────────────┬──────────────────────────────────────┤
│ Current Change        │ Verification Plan                    │
│                       │                                      │
│ 8 files               │ ✓ Build                              │
│ +294 -81              │ ✓ Type Check                         │
│                       │ ✓ Unit Tests                         │
│ Auth affected         │ ✓ Security                           │
│ Checkout affected     │ ✓ Checkout E2E                       │
│                       │ ○ Accessibility not required          │
├───────────────────────┴──────────────────────────────────────┤
│ Findings                                                     │
│ ⚠ Missing session-expiry regression test                     │
│ ℹ AI recommends checkout guest-flow verification             │
└──────────────────────────────────────────────────────────────┘
```

---

# 13. Main Navigation

| Section | Purpose |
|---|---|
| Overview | readiness, risk, latest verification |
| Changes | Git diff and blast radius |
| Test Plans | requirements and policies |
| Runs | verification history |
| Findings | failures, security issues, AI observations |
| Coverage | test/code relationship |
| Models | local AI and hardware |
| Integrations | testing tools, Git, CI and agents |
| Settings | privacy, resources, organization policies |

---

# 14. GUI Accessibility Requirements

Requirements include:

- full keyboard navigation;
- visible focus states;
- screen-reader-compatible labels;
- semantic HTML;
- no color-only status communication;
- scalable text;
- strong contrast;
- high-contrast theme;
- light/dark themes;
- reduced-motion support;
- configurable editor/font size;
- discoverable keyboard shortcuts;
- logical focus restoration;
- accessible tables;
- accessible chart equivalents;
- readable logs;
- OS scaling;
- correctly associated form errors.

---

# 15. CLI Is a First-Class Interface

Example:

```bash
verify init
verify inspect
verify plan
verify plan --diff HEAD~1
verify run
verify run --mode quick
verify run --mode full
verify gate
verify report
verify hardware
verify models
verify run --json
```

Example output:

```json
{
  "status": "BLOCK",
  "risk": "high",
  "passed": 42,
  "failed": 2,
  "findings": [
    {
      "severity": "critical",
      "source": "playwright",
      "test": "authenticated checkout"
    }
  ]
}
```

Exit codes:

```text
0 = PASS
1 = BLOCK
2 = execution/configuration error
3 = interrupted
```

---

# 16. AI Coding Agent Workflow

Example organization instructions:

```text
Before modifying authentication, permissions, payments,
database schema, deployment code or other high-risk areas:

1. Run `verify plan`.
2. Review required verification.
3. Make the change.
4. Run `verify run`.
5. Run `verify gate`.
6. Do not commit/deploy while the gate is BLOCK.
7. Resolve failures and rerun.
```

---

# 17. MCP Strategy

MCP should be supported, but not be the foundation.

```text
Core Engine
   ├── CLI
   ├── Desktop GUI
   ├── CI
   └── MCP Server
```

Possible tools:

```text
inspect_change
get_change_risk
create_verification_plan
run_verification
get_test_results
get_findings
generate_missing_test
explain_failure
check_release_gate
```

---

# 18. Local AI Strategy

Create an internal:

```text
ModelProvider
```

Initial implementations:

```text
ModelProvider
   ├── OllamaProvider
   ├── LlamaCppProvider
   └── OpenAICompatibleProvider
```

The application must not depend on one model family.

---

# 19. Do Not Embed an LLM Runtime in Version 1

Initially:

1. detect supported local providers;
2. connect;
3. inspect installed models;
4. verify capabilities;
5. recommend models;
6. provide setup assistance.

Managed installation can come later.

---

# 20. Hardware Advisor

Detect:

- OS;
- CPU;
- architecture;
- RAM;
- GPU;
- VRAM;
- unified memory;
- CUDA;
- ROCm/HIP;
- Metal;
- Vulkan;
- driver/runtime versions;
- available storage;
- current memory pressure;
- optional temperature/power data.

Display:

```text
Hardware Analysis

CPU: AMD Ryzen ...
RAM: 32 GB
GPU: NVIDIA RTX ...
VRAM: 12 GB
CUDA: Supported
Available disk: 412 GB

FAST
BALANCED
MAXIMUM QUALITY
```

---

# 21. Model Compatibility Catalog

Do not hard-code recommendations.

Catalog entry example:

```yaml
model: example-coder
variant: 14b-q4

runtime:
  - ollama
  - llama.cpp

requirements:
  disk_gb: 9
  ram_recommended_gb: 16
  vram_recommended_gb: 10

capabilities:
  coding: true
  structured_output: true
  tool_calling: true

profiles:
  planning: excellent
  failure_analysis: excellent
  test_generation: good
```

Statuses:

- Recommended
- Supported
- Slow
- Not Recommended
- Unsupported

---

# 22. Resource Guard

Profiles:

**Quiet**

**Balanced**

**Maximum Performance**

Controls may include:

- concurrent test jobs;
- maximum LLM context;
- maximum model size;
- memory target;
- pause inference during heavy browser/load tests;
- GPU utilization target;
- thermal-throttling preferences.

---

# 23. Internal AI Roles

```text
Change Analyzer
       ↓
Risk Classifier
       ↓
Test Planner
       ↓
Deterministic Test Execution
       ↓
Failure Investigator
       ↓
Missing-Test Generator
       ↓
Review Agent
       ↓
Evidence Synthesizer
```

Initially, one model may power all roles.

Later, model routing can assign smaller and larger models appropriately.

---

# 24. AI Outputs Must Be Structured

Example:

```typescript
ChangeAssessment {
  summary
  affectedAreas[]
  riskLevel
  riskReasons[]
  likelyTests[]
  missingCoverage[]
  confidence
}
```

Every AI workflow should define:

- input schema;
- output schema;
- timeout;
- maximum context;
- allowed tools;
- retry policy;
- failure behavior;
- capability requirements.

---

# 25. DeepSeek Harness Decision

**Do not fork DeepSeek Harness for version 1.**

Study:

- plugin architecture;
- model adapters;
- agent/tool separation;
- session architecture.

Potentially build integration later.

Our internal verification agent should remain smaller and purpose-specific.

---

# 26. Verification Agent Toolset

Initial tools:

```text
read_file
search_code
inspect_symbol
inspect_git_diff
get_dependencies
find_related_tests
get_test_history
run_approved_check
create_test_in_sandbox
run_test_in_sandbox
inspect_test_result
create_patch
```

No unrestricted generic shell by default.

---

# 27. AI Test Generation Safety

```text
AI proposes test
      ↓
Temporary Git worktree / sandbox
      ↓
Test created
      ↓
Test executed
      ↓
Result inspected
      ↓
Quality checks
      ↓
Patch presented
      ↓
User/authorized agent applies
```

---

# 28. Forking Strategy

## Do not fork

- Tauri
- Ollama
- llama.cpp
- Semgrep
- Playwright
- Cypress
- Vitest
- pytest
- DeepSeek Harness
- MCP SDK

## Integrate

- Tauri → desktop shell
- Ollama → model provider
- llama.cpp → model provider
- Semgrep → security adapter
- Playwright → test adapter
- Cypress → test adapter
- MCP SDK → agent interface
- Tree-sitter → parsing

Our core IP should be:

- repository intelligence;
- change-risk analysis;
- test planning;
- quality-gate system;
- normalization layer;
- local-AI workflows;
- organization policy;
- model/hardware advisor;
- private orchestration;
- evidence synthesis.

---

# 29. Recommended Technology Stack

## Primary Language

**TypeScript**

Most application logic should be TypeScript.

Rust should remain primarily within Tauri unless justified.

---

# 30. Desktop

**Tauri 2**

Frontend:

**React + TypeScript + Vite**

---

# 31. Core Engine Deployment

The verification engine should be TypeScript/Node.

During development:

```text
Node.js
```

Release:

```text
TypeScript core
      ↓
self-contained executable
      ↓
Tauri sidecar
```

The same executable should power CLI and GUI.

---

# 32. Desktop/Core Communication

Initial transport:

**newline-delimited structured messages over stdin/stdout**

Example:

```json
{"id":"123","method":"verification.run","params":{"mode":"quick"}}
```

Events:

```json
{"id":"123","event":"test.started","data":{}}
{"id":"123","event":"test.output","data":{}}
{"id":"123","event":"finding.created","data":{}}
{"id":"123","result":{"status":"pass"}}
```

---

# 33. Monorepo

Use:

**pnpm workspaces + Turborepo**

---

# 34. Proposed Repository Structure

```text
/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   └── src-tauri/
│   ├── cli/
│   └── mcp/
│
├── packages/
│   ├── domain/
│   ├── core/
│   ├── config/
│   ├── repository/
│   ├── code-intelligence/
│   ├── risk/
│   ├── verification/
│   ├── adapters/
│   │   ├── generic-command/
│   │   ├── vitest/
│   │   ├── jest/
│   │   ├── pytest/
│   │   ├── playwright/
│   │   ├── cypress/
│   │   ├── semgrep/
│   │   └── typescript/
│   ├── ai/
│   │   ├── providers/
│   │   ├── workflows/
│   │   ├── prompts/
│   │   └── tools/
│   ├── policy/
│   ├── sandbox/
│   ├── hardware/
│   ├── models/
│   ├── storage/
│   ├── reporting/
│   ├── protocol/
│   └── ui/
│
├── fixtures/
│   ├── javascript-basic/
│   ├── typescript-web/
│   ├── python-api/
│   ├── intentionally-broken/
│   └── large-project-simulation/
│
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── security/
│   ├── development/
│   ├── ADR/
│   └── tasks/
│
├── AGENTS.md
├── ARCHITECTURE.md
├── SECURITY.md
├── CONTRIBUTING.md
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

# 35. Package Responsibilities

## `domain`

Pure domain types.

## `core`

Application use cases.

## `repository`

Git, files, project discovery.

## `code-intelligence`

Parsing, symbols, graph, related tests.

## `risk`

Risk signals and scoring.

## `verification`

Planning and executing checks.

## `adapters`

External verification ecosystems.

## `ai`

Model providers and workflows.

## `policy`

PASS/WARN/BLOCK rules.

## `sandbox`

Worktrees and safe test generation.

## `hardware`

Hardware detection.

## `models`

Model catalog and recommendations.

## `storage`

SQLite.

## `reporting`

Terminal/JSON/SARIF/etc.

## `protocol`

Versioned inter-process/API schemas.

---

# 36. Local Database

Recommended:

**SQLite + Drizzle**

Repository policy remains in `.verify/project.yml`.

---

# 37. Frontend Stack

```text
React
TypeScript
Vite
Tauri 2
accessible UI primitives
Tailwind CSS
React Router
TanStack Query where appropriate
```

Reusable components belong in:

```text
packages/ui
```

---

# 38. Testing the Testing Application

## Unit Tests

Use Vitest.

## Contract Tests

Every adapter passes common behavioral tests.

## Fixture Repositories

Examples:

```text
fixture-auth-regression
fixture-missing-tests
fixture-broken-typescript
fixture-python-api
fixture-semgrep-vulnerability
fixture-flaky-test
```

## Integration Tests

Test full pipelines.

## Desktop UI Tests

Test components, accessibility and packaged-app smoke behavior.

## AI Evaluation Tests

Structured scenario regression tests.

---

# 39. Architecture Pattern

Use **ports-and-adapters / hexagonal architecture**.

```text
          Desktop
             │
CLI ─────── Core ─────── MCP
             │
      Domain / Policies
             │
     Ports / Interfaces
      ┌──────┼───────┐
      │      │       │
 Repository Tests    AI
```

Dependencies point inward.

---

# 40. Development Methodology When AI Builds the Application

Do not ask AI:

> Build the whole application.

Use small vertical slices.

Example:

```text
Feature: Inspect current Git changes

1. domain defines RepositoryChange
2. repository implements Git diff
3. core implements InspectChange
4. CLI exposes verify inspect
5. tests use fixture repository
6. output validated
7. docs updated
```

---

# 41. Root `AGENTS.md`

AI rules include:

```text
1. Read ARCHITECTURE.md before architectural changes.
2. Read package documentation.
3. Domain cannot depend on infrastructure.
4. GUI cannot contain verification business logic.
5. External tools require adapters.
6. AI providers implement ModelProvider.
7. No unrestricted shell.
8. New features require tests.
9. Architectural decisions require ADRs.
10. Dependencies require justification.
11. Protocol schemas cannot silently change.
12. Keep tasks small.
13. Run lint/typecheck/tests.
14. Update documentation with behavior changes.
```

---

# 42. Architecture Decision Records

Examples:

```text
ADR-001-use-tauri.md
ADR-002-typescript-core.md
ADR-003-no-deepseek-harness-fork.md
ADR-004-local-model-provider-interface.md
ADR-005-project-yaml.md
ADR-006-stdio-engine-protocol.md
ADR-007-test-generation-worktrees.md
```

---

# 43. Package Documentation

Every package documents:

```text
Purpose
Public API
Allowed dependencies
Forbidden dependencies
Data owned
Important invariants
Testing instructions
```

---

# 44. Feature Development Files

Example:

```text
docs/tasks/TASK-004-change-risk-engine.md
```

Contains:

- goal;
- non-goals;
- architecture;
- affected packages;
- acceptance criteria;
- tests;
- edge cases.

---

# 45. AI Coding Rules

**Contracts before implementation.**

**Vertical slices instead of giant layers.**

**No speculative abstraction.**

**External integrations behind adapters.**

**Structured data before prose.**

**Tests beside behavior.**

**Fixture repositories for difficult scenarios.**

**Security defaults to deny.**

**No silent fallback.**

**Deterministic logic before AI logic.**

---

# 46. Development Sequence

The broad sequence remains:

1. Architecture skeleton
2. Headless deterministic core
3. Project discovery
4. Code intelligence
5. Risk/test planning
6. Local AI
7. Test generation
8. Desktop GUI
9. Hardware advisor
10. Agent integration
11. Security expansion
12. Enterprise capabilities

The detailed modular delivery plan begins in Section 58.

---

# 47. Initial Language Scope

## Deep Support Initially

- TypeScript
- JavaScript
- Python

## Generic Support

Any language that can expose commands through configuration.

---

# 48. Initial Verification Adapters

Recommended:

```text
Generic Command
TypeScript Compiler
ESLint
Vitest
Jest
pytest
Playwright
Semgrep
```

---

# 49. Security and Privacy

Default expectations:

- source code stays local;
- local/private inference;
- telemetry opt-in;
- no source in telemetry;
- secret redaction;
- constrained subprocesses;
- generated-code sandbox;
- visible network use;
- optional cloud integration;
- visible inference target.

---

# 50. Enterprise Deployment Concept

```text
Developer Workstations
       │
       ▼
Company Verification Service
       │
       ├── Organization policies
       ├── Model routing
       ├── Reporting
       └── Audit logs
       │
       ▼
Company GPU Server
       │
       └── Local inference
```

---

# 51. First-Look User Experience

```text
1. Select repository
2. Scan project
3. Detect languages/frameworks
4. Detect tests
5. Detect Git status
6. Detect AI provider
7. Detect hardware
8. Generate verification configuration
9. User approves
10. Baseline verification runs
```

---

# 52. Example "Wow" Workflow

```text
HIGH RISK

Authentication middleware changed.

Affected:
• Login
• API authorization
• Checkout
• Account management
• Session expiry
• Password reset

Existing coverage:
4/6 workflows

Missing:
• Session expiry regression
• Password-reset token invalidation
```

Then:

```text
BLOCK

13 existing tests passed.
1 existing test failed.
1 generated regression test reproduced a defect 3/3 times.

Finding:
Expired session identity remains usable during checkout API request.
```

---

# 53. Core Product Principles

**Evidence over AI opinion.**

**Local/private by default.**

**Integrate mature testing ecosystems.**

**Change-aware verification over running everything.**

**Deterministic analysis before AI analysis.**

**One headless engine powers every interface.**

**AI is constrained by tools and schemas.**

**Repository configuration is version-controlled.**

**Generated changes are isolated and verified.**

**Large repositories are indexed, not dumped into context.**

---

# 54. Current Technical Decisions

```text
Primary language:
TypeScript

Desktop:
Tauri 2

Frontend:
React + Vite + TypeScript

Styling:
Tailwind + accessible primitives

Package management:
pnpm

Monorepo:
Turborepo

Testing:
Vitest

Storage:
SQLite + Drizzle

Repository parsing:
Tree-sitter

Source control:
Git

Local AI:
Ollama + OpenAI-compatible interface

Security:
Semgrep adapter

Browser testing:
Playwright first

Configuration:
.verify/project.yml

Internal AI:
Custom bounded workflow system

DeepSeek Harness:
Research/integration target, not fork

CLI:
First-class

MCP:
After CLI contracts stabilize

Desktop/core IPC:
Structured stdio

Generated tests:
Temporary Git worktrees

Architecture:
Ports-and-adapters

Initial languages:
TypeScript, JavaScript, Python
```

---

# 55. Current MVP Definition

The first convincing MVP must prove:

```text
Open repository
      ↓
Detect project
      ↓
Inspect Git change
      ↓
Determine basic risk
      ↓
Run configured checks
      ↓
Normalize evidence
      ↓
PASS / WARN / BLOCK
```

AI intelligence is deliberately introduced incrementally after this deterministic foundation is stable.

---

# 56. Features Outside Initial MVP

Do not initially build:

- device farm;
- custom browser engine;
- custom SAST engine;
- penetration-testing engine;
- CI/CD provider;
- cloud code host;
- unrestricted coding agent;
- custom LLM runtime;
- automatic deployment;
- unsandboxed source modification;
- universal deep language support;
- enterprise SSO.

---

# 57. Product Direction

Initial category:

> **Local AI-assisted code testing.**

Long-term category:

> **Software Verification Infrastructure for AI-Assisted Development.**

The platform should answer:

- What changed?
- What could it affect?
- What evidence proves it works?
- What remains untested?
- Should this code merge or deploy?

---

# 58. Modular Delivery Philosophy

The project must be developed so each iteration creates a **stable, tested release**.

A later feature must not require rewriting the working implementation of an earlier feature unless an explicit architectural migration has been approved.

The preferred pattern is:

```text
Stable Core
    │
    ├── New adapter
    ├── New provider
    ├── New workflow
    ├── New UI surface
    └── New policy
```

rather than:

```text
Feature added
    ↓
Core rewritten
    ↓
Existing behavior breaks
    ↓
Tests repaired afterward
```

Every iteration should behave as if it might become the released product.

---

# 59. Definition of an Iteration

An iteration is not merely a coding milestone.

An iteration is considered complete only when:

- the feature works;
- existing tests remain green;
- new functionality has tests;
- architecture boundaries remain valid;
- configuration changes are backward-compatible;
- CLI behavior remains compatible;
- database migrations are tested;
- documentation is updated;
- fixture repositories pass;
- a release build can be produced.

Every completed iteration should be tagged.

Example:

```text
v0.1.0
v0.2.0
v0.3.0
```

If a future iteration fails badly, developers should be able to return to the previous stable tag.

---

# 60. The Minimum Viable Product

The true MVP should be **smaller than the final product concept**.

Its purpose is to prove four things:

1. The system can understand a repository sufficiently to configure verification.
2. It can execute multiple existing testing tools through one interface.
3. It can normalize results into one Quality Gate.
4. The same engine works from both CLI and GUI.

AI should enhance the MVP but must not become a dependency for the basic workflow.

---

# 61. MVP Required Features

## Repository Opening

User can:

- select a local Git repository;
- see project name;
- see branch;
- see current Git status;
- see changed files.

## Project Initialization

Application creates:

```text
.verify/project.yml
```

It can suggest basic configuration but the user approves it.

## Generic Verification Commands

The user can configure:

```yaml
suites:
  test:
    command: npm test

  lint:
    command: npm run lint

  build:
    command: npm run build
```

The application executes them reliably.

## Verification Run

User can run:

```bash
verify run
```

The GUI exposes the same operation.

## Normalized Results

Each check produces:

- name;
- type;
- start time;
- duration;
- exit code;
- status;
- stdout/stderr;
- error summary.

## Quality Gate

Minimum policies:

```text
PASS
WARN
BLOCK
```

Example:

```text
build failure → BLOCK
test failure → BLOCK
lint warning → WARN
all required checks pass → PASS
```

## Run History

Store local execution history in SQLite.

## Basic GUI

The GUI needs only:

- repository selection;
- current change summary;
- configured checks;
- Run Verification;
- execution progress;
- findings;
- PASS/WARN/BLOCK result;
- previous runs.

## CLI

Required commands:

```bash
verify init
verify inspect
verify run
verify gate
```

## Stable Machine Output

At least:

```bash
verify run --json
```

## Tests

The MVP itself must contain:

- unit tests;
- adapter contract tests;
- fixture-repository integration tests;
- CLI integration tests;
- basic GUI tests.

---

# 62. MVP Explicitly Does Not Require

The first MVP does **not** require:

- AI test generation;
- dependency graph analysis;
- intelligent blast radius;
- MCP;
- Semgrep;
- Playwright-specific integration;
- hardware recommendations;
- model downloads;
- enterprise server;
- CI plugins;
- advanced accessibility audits;
- coverage visualization;
- multiple local AI providers.

These features are intentionally postponed.

---

# 63. Iteration 0 — Repository and Architecture Foundation

**Goal:** establish a codebase that AI agents cannot easily turn into a monolith.

Build:

- monorepo;
- pnpm;
- Turborepo;
- TypeScript;
- Vitest;
- linting;
- formatting;
- architecture package boundaries;
- `AGENTS.md`;
- `ARCHITECTURE.md`;
- ADR system;
- fixture framework;
- CI;
- release scripts.

Create initial packages:

```text
domain
core
config
repository
verification
protocol
storage
```

No GUI functionality yet.

### Acceptance criteria

```text
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

all succeed.

### Stability rule

No external test framework integrations yet.

This iteration establishes contracts only.

---

# 64. Iteration 1 — Generic Headless Verification Runner

**Goal:** make the application useful without AI or GUI.

Add:

```bash
verify init
verify run
verify gate
```

Implement the Generic Command adapter.

Example:

```yaml
suites:
  unit:
    command: npm test

  lint:
    command: npm run lint
```

Implement:

- process execution;
- timeout;
- cancellation;
- stdout/stderr capture;
- normalized result;
- Quality Gate;
- exit codes.

### User value

The application can already serve as a lightweight local verification gate.

### New packages affected

Primarily:

```text
verification
adapters/generic-command
policy
cli
```

### Existing code impact

Core contracts remain unchanged wherever possible.

---

# 65. Iteration 2 — Git Awareness

**Goal:** understand the current code change.

Add:

```bash
verify inspect
```

Detect:

- repository root;
- branch;
- changed files;
- staged files;
- unstaged files;
- additions/deletions;
- commit references.

Introduce domain objects:

```text
RepositoryChange
ChangedFile
GitReference
```

### GUI dependency

None yet.

### AI dependency

None.

### User value

Verification results can now be associated with actual code changes.

---

# 66. Iteration 3 — Project Discovery and Configuration Suggestions

**Goal:** reduce manual setup.

Detect:

- Node;
- Python;
- package managers;
- TypeScript;
- common scripts;
- common test frameworks.

Generate suggested:

```text
.verify/project.yml
```

Do not silently write configuration without approval.

### Initial discovery examples

Detect:

```text
package.json
pyproject.toml
pytest.ini
tsconfig.json
vite.config.*
vitest.config.*
jest.config.*
playwright.config.*
```

### Modular rule

Discovery only proposes configuration.

Execution still occurs through the already-tested verification engine.

---

# 67. Iteration 4 — Minimum Desktop GUI

**Goal:** expose the proven headless engine visually.

Add Tauri desktop.

Implement only:

- open repository;
- project overview;
- changed files;
- configured checks;
- Run Verification;
- live execution;
- results;
- PASS/WARN/BLOCK;
- run history.

The GUI calls the existing engine.

It contains no verification logic.

### Important architectural test

A CLI run and GUI run against the same repository/configuration must produce equivalent normalized results.

This becomes a permanent regression test.

### At this point

We have the **first full MVP**.

Tag:

```text
v0.1.0
```

---

# 68. Iteration 5 — Native Test Framework Adapters

**Goal:** obtain richer test information without changing the core runner.

Add adapters one at a time.

Suggested order:

1. Vitest
2. Jest
3. pytest
4. TypeScript compiler
5. ESLint

Each adapter receives its own package.

Example:

```text
packages/adapters/vitest
```

No adapter may require modification of another adapter.

### Adapter contract

Every adapter must pass:

```text
detect
plan
execute
normalize
timeout
cancellation
missing-tool handling
success
failure
```

### User value

Instead of merely:

```text
npm test failed
```

the application can understand:

```text
42 passed
2 failed
authentication/session.spec.ts failed
```

---

# 69. Iteration 6 — Basic Risk Engine

**Goal:** introduce change risk without AI.

Risk signals:

- number of files;
- diff size;
- configured critical paths;
- dependency/config files;
- migrations;
- infrastructure files;
- tests modified alongside production code.

Example:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

The first version should intentionally be simple and understandable.

Example:

```text
src/auth/** changed
→ HIGH

database/migrations/** changed
→ CRITICAL
```

### Important principle

Risk calculations must expose:

```text
risk
reasons[]
```

Never generate an unexplained score.

---

# 70. Iteration 7 — Test Planning Without AI

**Goal:** distinguish Quick Verify from Full Verify.

Add:

```bash
verify plan
verify run --mode quick
verify run --mode full
```

Initially use deterministic rules.

Example:

```yaml
rules:
  - changes:
      - src/auth/**
    require:
      - unit
      - auth-e2e
```

Now the system can decide:

> Because authentication changed, these checks are required.

### User value

This begins to establish the core product identity.

### Stability

Existing `verify run` behavior remains supported.

---

# 71. Iteration 8 — Local AI Provider Foundation

**Goal:** introduce AI without allowing it to control the system.

Implement:

```text
ModelProvider
OllamaProvider
```

AI can perform only one role initially:

**Change Explanation**

Input:

- diff;
- relevant file summaries.

Output:

```text
summary
affectedAreas[]
possibleRisks[]
confidence
```

AI cannot:

- modify code;
- execute arbitrary commands;
- change the Quality Gate;
- generate tests yet.

### Why start here

This validates:

- local inference;
- structured outputs;
- model errors;
- timeouts;
- context management;
- user hardware variability.

without introducing dangerous autonomy.

---

# 72. Iteration 9 — AI-Assisted Risk Assessment

**Goal:** combine AI reasoning with deterministic risk.

Architecture:

```text
DeterministicRisk
+
AIRiskAssessment
        ↓
RiskCoordinator
```

The deterministic system remains available if AI is disabled.

The application should clearly distinguish:

```text
Deterministic signals
AI observations
Final policy result
```

### Quality Gate

AI risk remains advisory in this iteration.

It cannot independently BLOCK.

---

# 73. Iteration 10 — Code Intelligence Foundation

**Goal:** understand code below the file level.

Add Tree-sitter.

Build:

- language detection;
- syntax parsing;
- symbol extraction;
- import extraction;
- changed symbol detection.

Initial languages:

1. TypeScript
2. JavaScript
3. Python

Store index information locally.

### Important rule

This is a new package:

```text
code-intelligence
```

The Git repository package should not be rewritten into a parser.

---

# 74. Iteration 11 — Dependency Graph and Blast Radius

**Goal:** understand what changed code may affect.

Add:

```text
Symbol
Module
DependencyEdge
BlastRadius
```

Example:

```text
auth/session.ts
      ↓
auth/middleware.ts
      ↓
checkout/api.ts
      ↓
checkout UI
```

Display blast radius in GUI.

### User value

The application can now explain:

> 3 files changed, but 17 modules may be affected.

This is an important differentiator.

---

# 75. Iteration 12 — Related Test Discovery

**Goal:** connect changed production code with existing tests.

Signals may include:

- imports;
- filenames;
- framework configuration;
- coverage information where available;
- historical execution;
- naming conventions.

Output:

```text
Direct tests
Likely related tests
Uncovered changed areas
```

This feeds Quick Verify.

### AI use

AI may advise, but deterministic relationships remain recorded separately.

---

# 76. Iteration 13 — Intelligent Verification Planning

**Goal:** reach the main product thesis.

Combine:

```text
Git change
+
Risk
+
Dependency graph
+
Related tests
+
Project requirements
+
AI reasoning
        ↓
Verification Plan
```

The plan must distinguish:

```text
Required
Recommended
Skipped
```

Every decision should have a reason.

Example:

```text
Required:
authentication unit suite
Reason:
directly tests modified authentication module

Required:
authenticated checkout E2E
Reason:
checkout depends on modified session middleware

Recommended:
session expiration regression
Reason:
no direct regression test located
```

Tag a major preview release here.

Example:

```text
v0.5.0
```

---

# 77. Iteration 14 — Failure Investigation AI

**Goal:** make failed verification easier to understand.

The AI receives:

- failing check;
- logs;
- relevant diff;
- relevant source;
- test source.

It returns:

```text
failureSummary
likelyCause
relatedChange
recommendedInvestigation[]
confidence
```

It does not automatically change code.

This keeps the feature isolated from code generation.

---

# 78. Iteration 15 — Playwright Integration

**Goal:** provide first-class browser/E2E evidence.

Add dedicated Playwright adapter.

Support:

- test discovery;
- test status;
- screenshots where generated;
- traces;
- browser errors;
- execution duration.

Do not build browser automation ourselves.

The Playwright adapter remains independent of unit-test adapters.

---

# 79. Iteration 16 — Security Adapter

**Goal:** add security evidence.

Start with Semgrep.

Create:

```text
packages/adapters/semgrep
```

Normalize:

- vulnerability;
- severity;
- file;
- location;
- rule;
- message.

Later tools can implement the same security finding contracts.

Do not change the risk engine to be Semgrep-specific.

Instead:

```text
Semgrep
   ↓
Normalized SecurityFinding
   ↓
Risk / Policy
```

---

# 80. Iteration 17 — Coverage Intelligence

**Goal:** understand missing test coverage.

Begin with importing existing coverage reports.

Support:

- LCOV;
- coverage.py outputs;
- framework-specific adapters as necessary.

Show:

```text
changed lines covered
changed lines uncovered
affected modules with no related tests
```

Focus on **changed-code coverage** before repository-wide vanity metrics.

---

# 81. Iteration 18 — Missing-Test Recommendations

**Goal:** allow AI to identify what should be tested without writing code yet.

AI can return:

```text
MissingTestProposal {
  behavior
  reason
  suggestedType
  targetFiles
  priority
}
```

Example:

```text
Suggested:
Session-expiry regression test

Reason:
Session validation changed and no test exercising expired sessions was found.

Priority:
HIGH
```

The human can accept/reject proposals.

---

# 82. Iteration 19 — Sandboxed AI Test Generation

**Goal:** allow AI-generated tests safely.

Introduce:

```text
sandbox
```

Workflow:

```text
Proposal
   ↓
Temporary Git worktree
   ↓
AI creates test
   ↓
Test runs
   ↓
Lint/typecheck
   ↓
Patch shown
```

Do not automatically apply.

### Quality controls

Generated tests should be rejected if:

- they do not execute;
- they merely assert trivial truths;
- they modify production source unexpectedly;
- they remove existing assertions;
- they require undeclared dependencies without approval.

---

# 83. Iteration 20 — Hardware Advisor

**Goal:** make local AI accessible to non-experts.

Detect:

- CPU;
- RAM;
- GPU;
- VRAM;
- runtime support;
- storage.

Recommend:

- Fast;
- Balanced;
- Maximum Quality.

No automatic download yet.

This iteration remains isolated under:

```text
hardware
models
```

---

# 84. Iteration 21 — Multiple Model Providers

Add independently:

1. OpenAI-compatible local endpoints
2. llama.cpp
3. LM Studio compatibility if needed
4. private enterprise inference endpoints

The rest of the application uses only:

```text
ModelProvider
```

No AI workflow should know whether Ollama or llama.cpp is underneath it.

---

# 85. Iteration 22 — Resource Guard

Add:

```text
Quiet
Balanced
Maximum Performance
```

Coordinate:

- AI concurrency;
- test concurrency;
- browser execution;
- memory usage.

This belongs to runtime scheduling rather than model logic.

---

# 86. Iteration 23 — Requirements Manager

**Goal:** mature project-specific testing rules.

GUI support for:

- creating requirements;
- editing requirements;
- mapping source paths;
- mapping tests;
- setting severity;
- setting failure policy.

Natural-language rule creation can use local AI.

The saved source of truth remains:

```text
.verify/project.yml
```

---

# 87. Iteration 24 — MCP Server

Only introduce MCP after CLI/core interfaces are stable.

Map existing use cases rather than create a parallel system.

Example:

```text
verify inspect
→ inspect_change

verify plan
→ create_verification_plan

verify run
→ run_verification

verify gate
→ check_release_gate
```

MCP becomes another adapter over the core.

---

# 88. Iteration 25 — AI Coding Agent Integration Pack

Provide ready-made instructions/templates for:

- Codex;
- Claude-style coding agents;
- DeepSeek Harness;
- generic shell-capable agents;
- MCP-capable agents.

Example policy:

```text
After modifying high-risk code:

verify plan
verify run
verify gate

Do not finalize if exit code != 0.
```

This iteration requires little change to the core product.

It mainly packages stable interfaces.

---

# 89. Iteration 26 — CI Integration

Begin with generic CI.

Example:

```bash
verify run --mode full --json
verify gate
```

Then add templates for:

- GitHub Actions;
- GitLab CI;
- Azure DevOps;
- others later.

The CLI remains the underlying mechanism.

Avoid implementing CI-provider-specific verification logic.

---

# 90. Iteration 27 — Historical Intelligence

Use stored runs to answer:

- which tests frequently fail;
- which tests are flaky;
- which modules frequently break;
- which areas have weak coverage;
- which types of changes produce regressions.

Historical data becomes another signal into planning.

AI can summarize it, but storage/statistics remain deterministic.

---

# 91. Iteration 28 — Flaky Test Detection

Track:

```text
pass/fail history
execution time
intermittent failure
rerun outcomes
```

Classify tests as potentially flaky.

A flaky test should be clearly differentiated from:

```text
reproducible regression
```

This improves release decisions considerably.

---

# 92. Iteration 29 — Deep Audit Mode

Now introduce repository-wide analysis.

Possible checks:

- architecture;
- duplicate code;
- untested areas;
- security;
- dependencies;
- accessibility;
- maintainability;
- performance configuration;
- obsolete tests;
- suspicious patterns.

Deep Audit remains separate from Quick Verify.

---

# 93. Iteration 30 — Enterprise Local Server

Only after the desktop product is stable.

Add:

```text
Central Verification Service
```

Capabilities:

- centralized policies;
- shared AI inference;
- shared model catalog;
- audit logs;
- organization configuration.

Developer machines remain clients of the same underlying contracts.

---

# 94. Iteration 31 — Air-Gapped Enterprise Mode

Support:

- offline installers;
- local vulnerability databases;
- offline model packages;
- disabled outbound network access;
- offline update bundles;
- enterprise policy bundles.

This becomes a premium deployment model.

---

# 95. Iteration 32 — Enterprise Administration

Potential features:

- roles;
- organization-level gates;
- locked policies;
- project exemptions;
- audit trails;
- centralized reports;
- approval workflows;
- model allowlists;
- resource quotas.

Only build these after real enterprise demand confirms them.

---

# 96. Rules for Adding Any New Feature

Every feature proposal should answer:

### 1. Which package owns it?

If unclear, architecture needs review.

### 2. Does it require changing an existing interface?

Prefer extension over modification.

### 3. Can it be disabled?

New risky functionality should initially be feature-flagged.

### 4. What tests prove it works?

Acceptance criteria are defined before coding.

### 5. What existing behavior could regress?

Add regression tests before implementation if necessary.

### 6. Does configuration change?

Version the schema.

### 7. Does stored data change?

Use an explicit migration.

### 8. Does protocol output change?

Maintain backward compatibility or increment protocol version.

### 9. Does this need AI?

Use deterministic code when possible.

### 10. Does it introduce a dependency?

Document the reason through an ADR when significant.

---

# 97. Stable Core vs Experimental Features

The application should distinguish:

## Stable

- repository operations;
- configuration;
- verification runner;
- adapters;
- Quality Gate;
- protocol;
- storage;
- CLI.

## Evolvable

- code intelligence;
- risk formulas;
- planning strategies;
- model providers.

## Experimental

- autonomous test generation;
- automatic code fixes;
- advanced AI review;
- new agent workflows.

Experimental functionality must never destabilize Stable components.

---

# 98. Feature Flags

Potential feature flags:

```text
ai_change_analysis
ai_risk
ai_test_planning
ai_failure_analysis
ai_test_generation
semgrep
playwright
mcp
hardware_advisor
```

During early development:

```text
Stable feature → enabled by default
Experimental feature → disabled by default
```

This lets developers merge unfinished infrastructure safely without exposing incomplete behavior.

---

# 99. API and Protocol Versioning

The core protocol should contain:

```text
protocolVersion
```

Example:

```json
{
  "protocolVersion": 1,
  "id": "123",
  "method": "verification.run"
}
```

Rules:

- fields may be added compatibly;
- fields must not silently change meaning;
- removals require a version increment;
- GUI declares compatible versions;
- MCP/CLI adapters use the same schemas.

---

# 100. Configuration Versioning

Every project configuration contains:

```yaml
version: 1
```

If configuration evolves:

```text
v1
↓ migration
v2
```

The application should provide:

```bash
verify config migrate
```

Never silently corrupt or rewrite user configuration.

---

# 101. Database Migration Policy

Every storage change requires:

- forward migration;
- migration test;
- existing-data fixture;
- rollback consideration;
- backup where appropriate.

SQLite schema changes must never be manually improvised during runtime.

---

# 102. Adapter Isolation Rule

No external integration should leak framework-specific concepts into the core.

Bad:

```text
CoreVerificationResult.playwrightTracePath
```

Better:

```text
Artifact {
  type: "trace"
  path: ...
  source: "playwright"
}
```

This allows Cypress or future tools to produce equivalent artifacts.

---

# 103. Model Provider Isolation Rule

Bad:

```typescript
runOllamaPrompt(...)
```

throughout the application.

Correct:

```typescript
modelProvider.generateStructured(...)
```

Only `OllamaProvider` knows Ollama-specific APIs.

---

# 104. AI Workflow Versioning

Prompts and AI workflows should be versioned.

Example:

```text
change-analyzer/v1
risk-reviewer/v1
test-planner/v2
```

Every verification run records:

- workflow version;
- model;
- provider;
- model parameters where relevant.

This makes AI behavior reproducible enough for debugging.

---

# 105. Golden Fixture Repositories

Before adding major intelligence, maintain expected scenarios.

Example:

```text
fixtures/
  auth-safe-change/
  auth-regression/
  payment-risk/
  missing-test/
  irrelevant-doc-change/
  broken-build/
  flaky-test/
```

Each fixture contains expected outcomes.

Example:

```yaml
expected:
  risk: high

  required_checks:
    - auth-unit

  gate:
    status: block
```

Every iteration runs these fixtures.

This is one of the strongest protections against AI-driven regression.

---

# 106. Compatibility Test Matrix

Eventually test combinations such as:

```text
Windows
macOS
Linux
```

with:

```text
Node project
Python project
mixed repository
```

and:

```text
AI disabled
Ollama available
Ollama unavailable
```

The application should always remain useful when AI is unavailable.

---

# 107. Release Channels

Recommended later:

```text
Stable
Preview
Nightly
```

**Stable**

Only fully tested features.

**Preview**

New adapters/AI capabilities.

**Nightly**

Development builds.

Enterprise customers should default to Stable.

---

# 108. Semantic Versioning

Use:

```text
MAJOR.MINOR.PATCH
```

Example:

```text
0.1.0 MVP
0.2.0 native adapters
0.3.0 risk engine
0.4.0 local AI
0.5.0 intelligent planning
0.6.0 test generation
```

Before `1.0`, architecture may still evolve.

`1.0` should mean:

- stable CLI;
- stable project configuration;
- stable protocol;
- tested upgrade path;
- reliable desktop packaging;
- mature verification core.

---

# 109. Suggested Major Product Milestones

## Milestone A — Deterministic MVP

Includes Iterations 0–4.

Product can:

```text
open project
run configured checks
show results
apply Quality Gate
work through CLI + GUI
```

Release:

```text
v0.1
```

---

## Milestone B — Developer-Useful Tester

Includes native adapters, Git awareness, discovery and deterministic risk/planning.

Product can:

```text
understand change
choose configured checks
provide richer findings
```

Release target:

```text
v0.3
```

---

## Milestone C — Local AI Assistant

Includes:

- model provider;
- AI change review;
- AI risk;
- failure explanation.

Product becomes meaningfully AI-assisted.

Release target:

```text
v0.4
```

---

## Milestone D — Intelligent Verification Engine

Includes:

- code intelligence;
- dependency graph;
- blast radius;
- related-test discovery;
- intelligent planning.

This proves the major differentiator.

Release target:

```text
v0.5
```

---

## Milestone E — AI Test Engineer

Includes:

- missing-test proposals;
- sandboxed generation;
- generated-test execution;
- patch review.

Release target:

```text
v0.6
```

---

## Milestone F — Agent-Ready Platform

Includes:

- MCP;
- stable machine output;
- coding-agent integration packs;
- CI.

Release target:

```text
v0.7
```

---

## Milestone G — Mature Verification Platform

Includes:

- security;
- coverage;
- historical intelligence;
- flake analysis;
- Deep Audit.

Release target:

```text
v0.9
```

---

## Milestone H — Production 1.0

Requirements:

- stable APIs;
- stable configuration;
- stable CLI;
- Windows/macOS/Linux validation;
- updater;
- migrations;
- crash recovery;
- security review;
- privacy documentation;
- model-provider reliability;
- extensive fixtures;
- polished onboarding.

Release:

```text
v1.0
```

---

# 110. What We Should Validate Before Building the Next Major Layer

At the end of each milestone, ask:

### After Deterministic MVP

Do developers actually want one unified local Quality Gate?

### After Risk/Planning

Does selective testing save meaningful time without missing failures?

### After AI Integration

Does local AI provide enough value relative to its hardware cost?

### After Code Intelligence

Is blast-radius analysis reliable across real projects?

### After Test Generation

Do generated tests find real defects rather than merely increase coverage?

### After Agent Integration

Will coding-agent users actually invoke the verifier consistently?

### Before Enterprise

Are organizations asking for centralized private inference and policy enforcement?

This avoids spending months building features that users do not need.

---

# 111. Recommended Immediate Build Target

The AI development team should initially build only:

```text
Iteration 0
Iteration 1
Iteration 2
Iteration 3
Iteration 4
```

This produces the smallest legitimate product.

The first working application should therefore:

1. open a repository;
2. detect basic project structure;
3. create configuration;
4. inspect Git changes;
5. execute configured commands;
6. normalize results;
7. evaluate PASS/WARN/BLOCK;
8. store previous runs;
9. expose CLI;
10. expose a small desktop GUI.

Nothing involving sophisticated AI should be allowed to delay this.

---

# 112. The First AI Feature to Add After MVP

Once the deterministic product is stable, the first AI capability should be:

> **Explain the current code change and identify likely risk areas.**

Not:

> Automatically write tests.

This lets us validate:

- local-model installation;
- context retrieval;
- structured outputs;
- hardware performance;
- model quality;
- user trust.

with very low operational risk.

---

# 113. The Second AI Feature

After change analysis is reliable:

> **AI-assisted verification planning.**

The AI can recommend:

- which existing suites should run;
- which areas appear uncovered;
- what should receive additional human attention.

Still no code modification.

---

# 114. The Third AI Feature

After planning becomes reliable:

> **Failure investigation.**

The AI explains:

- what failed;
- whether the failure is related to the current change;
- likely cause;
- relevant files.

Again, it remains read-only.

---

# 115. The Fourth AI Feature

Only after the first three are stable:

> **Generate missing tests inside an isolated sandbox.**

This progression deliberately increases AI authority slowly:

```text
Observe
   ↓
Recommend
   ↓
Investigate
   ↓
Generate in isolation
   ↓
Potentially modify with authorization
```

This should be a foundational AI safety principle for the application.

---

# 116. Long-Term AI Autonomy Ladder

The product can expose autonomy levels.

## Level 0 — AI Disabled

Pure deterministic verification.

## Level 1 — Explain

AI summarizes evidence.

## Level 2 — Recommend

AI recommends tests/actions.

## Level 3 — Generate Safely

AI creates candidate tests in sandbox.

## Level 4 — Apply With Approval

User authorizes proposed test patches.

## Level 5 — Agent-Controlled Verification

Authorized coding agents can apply changes under policy.

Organizations choose their permitted level.

The application should never assume maximum autonomy.

---

# 117. Final Development Principle

The project should evolve as:

```text
Simple deterministic verifier
        ↓
Reliable quality gate
        ↓
Change-aware verifier
        ↓
Code-intelligent verifier
        ↓
Local AI-assisted verifier
        ↓
AI-generated regression testing
        ↓
Agent verification infrastructure
        ↓
Enterprise private verification platform
```

Each step must remain useful independently.

The project must never require the unfinished future version in order for the present version to work.

That modular evolution is what will keep an AI-built codebase maintainable, testable and commercially usable.
