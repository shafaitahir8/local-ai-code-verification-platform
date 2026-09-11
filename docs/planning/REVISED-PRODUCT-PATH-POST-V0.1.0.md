# Local AI Code Verification Platform
## Revised Product Path After v0.1.0

**Status:** Product direction reset after v0.1.0  
**Purpose:** Preserve the deterministic verification engine already built, while restoring the original product idea: a simple local-AI-first experience where the software understands the project, decides how it should be checked, and lets the user adjust the plan if needed.

---

# 1. Product Direction

The deterministic engine, native Windows delivery, persistence, cancellation, process cleanup, and PASS/WARN/BLOCK model remain valuable and should stay.

However, they are implementation infrastructure rather than the main user experience.

The intended product experience is:

> Open a repository → Local AI understands the project → the application proposes what should be checked → the user starts simple tasks with clear buttons → technical details remain visible for transparency → the user can override or customize the plan when needed.

The normal user should not need to understand `.verify/project.yml`, manually decide which commands belong in the plan, or know the internal adapter architecture.

`.verify/project.yml` should remain the persistent project configuration and advanced/power-user layer, but the application should normally create and maintain it on the user's behalf.

---

# 2. Product Hierarchy

- **Local AI = brains**
  - Understands the project.
  - Interprets repository structure and tooling.
  - Determines likely development/test/run behavior.
  - Recommends verification actions.
  - Explains results.
  - Helps update configuration when the user changes preferences.

- **Deterministic engine = execution and evidence**
  - Runs known commands and tools.
  - Captures stdout/stderr.
  - Enforces cancellation.
  - Produces normalized results.
  - Stores evidence and history.
  - Produces PASS / WARN / BLOCK.

- **Framework/tool adapters = sensors**
  - Detect frameworks, package managers, test runners, build tools, linters, static-analysis tools, project signals, and available scripts.
  - Feed reliable structured facts to the planner and AI.
  - They are not the main user-facing feature.

- **`.verify/project.yml` = persistent project policy**
  - Generated or updated automatically where possible.
  - Editable through the GUI.
  - Still directly editable by advanced users.
  - Version-controlled when the user chooses to keep it in the repository.

- **GUI = simple control and explanation layer**
  - User starts tasks with understandable buttons.
  - Technical detail remains available underneath.
  - Complex configuration is secondary, not required before useful work can begin.

---

# 3. Core UX Principle

The product should use **simple actions that initiate technically sophisticated workflows**.

## Understand Project

Analyzes the repository and explains what kind of project it appears to be, what tooling is available, how it is likely run, and how it should be verified.

## Check for Test Cases

Searches for existing tests and test infrastructure.

The implementation is intentionally not limited to a single detection technique. It may use:
- deterministic file and framework discovery;
- package scripts;
- configuration files;
- naming conventions;
- framework adapters;
- local AI reasoning;
- repository indexing;
- other safe techniques.

From the UX perspective:

> Click **Check for test cases** → analysis begins → progress/status is visible → user can press **Stop** at any time.

This is especially important for large codebases where local AI analysis may take significant time.

## Run Project

Attempts to determine the correct way to launch or preview the selected project.

Examples:
- A simple HTML website may need `index.html` opened or served through a lightweight local server.
- A Vite project may need its dev script.
- A Next.js project may need its development command.
- A Python application may have a different entry point.
- A monorepo may require the user to choose a package/application if the intent is ambiguous.

The implementation may combine deterministic discovery and local AI reasoning.

The user should not need to know the correct command first.

Before executing an unfamiliar or AI-derived command, the UI should make the intended action visible and allow the user to review it.

## Run Tests

Runs the tests the system believes apply to the current project.

If multiple test suites exist, the application may offer a simple choice such as:
- Relevant tests
- All tests
- Choose test suite

## Verify Changes

The primary everyday action.

Inspects the current Git changes and determines an appropriate verification plan from:
- project understanding;
- available tooling;
- test coverage;
- configured policy;
- current changes;
- local AI reasoning.

Then it executes the approved deterministic checks and returns PASS / WARN / BLOCK.

## Full Verification

Runs the broader project verification plan regardless of whether every check is relevant to the current diff.

## Review / Customize Plan

Allows the user to see and change what the application intends to run.

Examples:
- disable full builds during Quick Verify;
- include a slower integration suite only in Full Verification;
- change which package is launched;
- exclude generated folders;
- add a custom command;
- override an incorrect AI assumption.

The application should persist accepted preferences through `.verify/project.yml` or an equivalent versioned policy representation.

---

# 4. Suggested Main Action Area

Suggested actions:

1. **Understand Project**
2. **Verify Changes**
3. **Check for Test Cases**
4. **Run Tests**
5. **Run Project**
6. **Full Verification**
7. **Review / Customize Plan**

Not every action has to be available immediately.

Buttons should be enabled, disabled, or annotated based on current project knowledge.

Examples:
- `Run Tests` → disabled with "No tests detected yet" until analysis completes.
- `Run Project` → "HTML preview detected" for a simple static website.
- `Verify Changes` → may work using deterministic discovery even before local AI is configured.
- `Check for Test Cases` → while running, changes to an obvious `Stop` action.

---

# 5. Technical Detail Should Remain Visible

The existing technical panels are useful and should not be removed.

They should become **evidence and transparency panels**, rather than prerequisites for using the software.

Useful technical panels include:
- Project detected
- Frameworks/tooling detected
- Current Git changes
- Recommended verification plan
- Commands that will run
- Checks currently running
- Local command output
- PASS / WARN / BLOCK evidence
- Run duration
- History
- Configuration source
- Local AI reasoning summary
- Why a check was selected
- Why a check was skipped
- Cancellation/process status

A normal workflow should be:

> Simple button at the top → detailed technical execution appears below.

---

# 6. Automatic Configuration

A preferred flow:

1. Inspect repository deterministically.
2. Detect known project/tool/framework signals.
3. Build a structured project profile.
4. Ask the local AI to reason about ambiguous or incomplete parts.
5. Produce a proposed project plan.
6. Show the plan in plain language.
7. Allow the user to accept or change it.
8. Persist the accepted plan in `.verify/project.yml`.
9. Execute through the deterministic verification engine.

The user should not be required to hand-author YAML before the application becomes useful.

The user may still open an advanced view to inspect or directly edit the YAML.

---

# 7. Local AI Behavior

Local AI should not become an unrestricted shell agent.

A safer split is:

1. AI analyzes structured repository evidence.
2. AI recommends an action or verification plan.
3. The plan is converted into explicit deterministic operations.
4. The UI shows important actions/commands where appropriate.
5. The user starts or approves the operation.
6. The existing deterministic runner performs it.
7. The AI may explain the resulting evidence.

Long-running AI operations must:
- expose clear status;
- be cancellable;
- terminate owned work cleanly;
- preserve useful partial/recovery state where appropriate.

---

# 8. Revised Roadmap

## Iteration 5 — Project Intelligence Foundation

**Goal:** Give the platform reliable structured knowledge about the selected repository.

Build or improve native project/tool adapters and discovery, but treat these as internal sensors.

Target capabilities:
- project type/framework discovery;
- package manager discovery;
- scripts/tasks discovery;
- test framework discovery;
- build tooling discovery;
- lint/typecheck tooling discovery;
- likely project entry/run behavior;
- monorepo/workspace signals where practical;
- existing test/config locations;
- structured capability model consumable by core, GUI, CLI, and future AI.

UX additions may begin here:
- clearer "Detected project" information;
- a basic `Understand Project` action;
- automatic recommended checks when confidence is high;
- no expectation that the user manually populates `.verify/project.yml`.

**Important:** Do not overbuild UI or AI in this iteration if the project-intelligence contracts are not stable yet.

## Iteration 6 — Automatic Verification Planning

**Goal:** Turn project intelligence into a useful default plan automatically.

Capabilities:
- generate a reasonable verification plan from discovered tools;
- distinguish quick/relevant checks from full verification;
- propose commands rather than requiring manual YAML;
- create/update `.verify/project.yml` through application logic;
- show why each check was chosen;
- allow user overrides;
- preserve generic custom commands.

UX:
- `Verify Changes`
- `Full Verification`
- `Review / Customize Plan`
- better empty state than "0 commands from project.yml"
- automatic plan suggestion when a repository is opened.

AI should not be required for obvious deterministic cases.

## Iteration 7 — Local AI Project Understanding

**Goal:** Introduce the local AI as the reasoning layer originally intended for the product.

Capabilities:
- reason over structured repository/project evidence;
- explain what type of project this is;
- resolve ambiguous project/run/test setups;
- recommend verification strategy;
- determine likely launch behavior;
- identify likely test suites;
- explain missing verification coverage;
- propose configuration changes.

UX:
- `Understand Project`
- AI-generated project summary
- recommended plan with plain-language reasoning
- user acceptance/override controls

The AI should use indexed/selected context, not indiscriminately dump entire large repositories into a model.

## Iteration 8 — User-Initiated Smart Tasks

**Goal:** Make the product useful through simple task buttons backed by the deterministic engine and local AI.

Primary actions:

### Check for Test Cases
- Analyze repository for tests and testing infrastructure.
- Show progress.
- Provide a prominent `Stop` button while running.
- Summarize discovered suites, locations, frameworks, and gaps.
- Do not constrain implementation to filename scanning only.

### Run Project
- Determine likely startup/preview behavior.
- Show the selected strategy.
- Start the project.
- Provide `Stop`.
- Capture logs.
- Avoid hidden unrestricted AI shell execution.
- Handle simple HTML sites intelligently, including discovering `index.html` and choosing an appropriate local preview method.

### Run Tests
- Run automatically discovered/approved test suites.
- Offer Relevant / All where meaningful.
- Show individual results and logs.

### Verify Changes
- Use project intelligence + policy + local AI reasoning to choose relevant checks.

### Full Verification
- Run the broader accepted project plan.

Technical evidence panels remain below these actions.

## Iteration 9 — AI-Assisted Configuration and Explanation

**Goal:** Let users modify behavior naturally without requiring them to understand configuration syntax.

Examples:

> "Don't run the full build during quick verification."

> "Use this test command for the API package."

> "Ignore generated files in this folder."

> "This is a static site; don't look for an application server."

The AI converts the user's preference into an explicit configuration proposal.

The user reviews/accepts it.

The application then updates `.verify/project.yml`.

Additional capabilities:
- explain failures;
- explain why checks were selected;
- explain why the gate is PASS/WARN/BLOCK;
- identify likely missing checks;
- suggest test improvements without automatically changing source.

## Later Iterations

After the above experience is stable:
- deterministic change-risk engine;
- affected-code/test planning;
- deeper code intelligence/indexing;
- safe test generation in sandbox/worktree;
- hardware/model advisor;
- MCP interface;
- CI integration improvements;
- controlled agent autonomy.

The product direction must remain:

> **AI understands and recommends; deterministic systems execute and prove; the user stays in control.**

---

# 9. Design Principles for All Future Iterations

1. **Simple first, technical underneath.**
2. **No manual YAML required for basic use.**
3. **AI should make the system easier, not less predictable.**
4. **Every long-running operation should be cancellable.**
5. **Show what is happening.**
6. **Never silently run arbitrary AI-generated commands.**
7. **Preserve deterministic evidence and PASS/WARN/BLOCK.**
8. **Keep the software useful when AI is unavailable.**
9. **Allow advanced users to inspect and override everything important.**
10. **Treat adapters as internal intelligence sources, not the product itself.**
11. **The selected repository is the central context.**
12. **Prefer automatic sensible defaults over configuration-first UX.**

---

# 10. Immediate Planning Task

Before implementing the revised roadmap, Codex should review:
- the original product/technical specification;
- current architecture and ADRs;
- v0.1.0 implementation;
- current Iteration 5 plan;
- `.verify/project.yml` schema;
- current discovery logic;
- GUI structure;
- CLI/core contracts;
- model-provider plans;
- cancellation/process architecture.

It should then produce a revised implementation plan showing:
- what remains valid from the original roadmap;
- what needs to change;
- what should be reordered;
- how to introduce the AI-first UX without discarding the deterministic foundation;
- how each simple user action maps to underlying core operations;
- where local AI is needed versus deterministic discovery;
- what configuration changes are necessary;
- what contracts must remain backward-compatible;
- which existing v0.1.0 functionality should remain untouched.

No implementation should begin until that plan is coherent.
