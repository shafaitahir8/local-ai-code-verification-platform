# Fixture repositories

These small projects are copied to temporary directories and initialized as real Git repositories by
integration tests. They exercise the application through actual subprocess and Git boundaries.

- `basic-pass`: test, lint, and build commands succeed.
- `failing-test`: a required test command fails.
- `failing-build`: a required build command fails.
- `git-changes`: tracked files suitable for staged and unstaged change tests.
- `project-intelligence/node-vite-vitest`: metadata-only Node/Vite/Vitest discovery evidence; its
  scripts and test file must never execute during profiling.

Generated `.git` directories and SQLite histories never belong in these source fixtures.
