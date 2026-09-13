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

Generated `.git` directories and SQLite histories never belong in these source fixtures.
