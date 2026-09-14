# Fixture repositories

These small projects are copied to temporary directories and initialized as real Git repositories by
integration tests. They exercise the application through actual subprocess and Git boundaries.

- `basic-pass`: test, lint, and build commands succeed.
- `failing-test`: a required test command fails.
- `failing-build`: a required build command fails.
- `git-changes`: tracked files suitable for staged and unstaged change tests.
- `project-intelligence/node-vite-vitest`: metadata-only Node/Vite/Vitest discovery evidence; its
  root `index.html` proves that Vite takes precedence over plain-static classification. Its scripts
  and test file must never execute during profiling.
- `project-intelligence/node-jest`: metadata-only Jest configuration, dependency, script, and test
  location evidence; its scripts and tests must never execute during profiling.
- `project-intelligence/plain-static`: a root `index.html` proving a plain static-site preview
  capability without creating or running a preview command.
- `project-intelligence/python-pytest`: explicit Python packaging, pytest dependency/configuration,
  and conventional Python test-path evidence with execution traps.
- `project-intelligence/python-malformed`: malformed Python and pytest metadata proving warnings and
  no pytest inference from filenames or a related package name alone.
- `project-intelligence/workspace-npm`: one declared npm child workspace and observed child scripts.
- `project-intelligence/workspace-pnpm`: a pnpm workspace include/exclude declaration.
- `project-intelligence/workspace-yarn`: the Yarn object-form workspace declaration.
- `project-intelligence/workspace-ambiguous`: multiple credible workspace, test, and run candidates
  that must remain unselected.
- `project-intelligence/mixed-node-python`: concurrent Node/Vitest and Python/pytest evidence that
  remains visible as two ecosystems with explicit test-framework ambiguity.

Generated `.git` directories and SQLite histories never belong in these source fixtures.
