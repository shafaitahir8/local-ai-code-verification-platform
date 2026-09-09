# ADR-007: Package the TypeScript Engine as a Node Single Executable

- Status: Accepted
- Date: 2026-09-08
- Applies to: CLI composition, SQLite storage bootstrap, Windows desktop delivery

## Context

The desktop must run the existing TypeScript application core on an end-user Windows machine that
has neither Node.js nor the development checkout. The engine also depends on the native
`better-sqlite3` addon, while Tauri requires a target-specific executable for `externalBin`.

## Decision

Build a Windows x64 Node 24 single executable application (SEA) from a fully bundled CommonJS entry.
Embed the matching `better-sqlite3` `win32-x64` addon as a SEA asset. At startup, hash the embedded
bytes with SHA-256, publish them atomically to a content-addressed per-user cache, verify the cached
bytes, load the addon with `process.dlopen`, and inject that binding through the CLI composition root.

Use the official Node resource-injection workflow with development-only `postject` pinned to
`1.0.0-alpha.6`. Name the output `verify-engine-x86_64-pc-windows-msvc.exe` so Tauri can declare the
base path as an `externalBin`. Normal source CLI development remains ESM and uses installed Node.js;
only the delivery sidecar uses the SEA entry and its different argument offset.

## Reasons

- The TypeScript core remains the sole implementation for CLI and desktop behavior.
- The shipped executable contains its JavaScript runtime and does not resolve packages from disk.
- Injecting the native binding through the existing storage adapter avoids a second persistence
  implementation or a storage migration.
- A content hash prevents loading incomplete or stale extracted addon bytes.

## Consequences

- Sidecars are platform- and architecture-specific and must be rebuilt with a Node runtime compatible
  with the embedded native addon.
- The unsigned post-injection executable may trigger platform reputation warnings until release
  signing is configured.
- The native addon is materialized under local per-user application data because Windows cannot load
  a Node addon directly from an in-memory SEA asset.
- Windows CI and release validation must build and smoke-test the executable with Node absent from the
  child `PATH`, from a working directory outside the checkout.

## Alternatives considered

- Shipping a JavaScript bundle beside an installed Node runtime was rejected because it preserves an
  end-user Node dependency and expands the bundle surface.
- Replacing `better-sqlite3` and the established Drizzle storage adapter was rejected as unrelated
  persistence redesign during delivery hardening.
- Third-party executable packagers were rejected in favor of Node's maintained SEA mechanism and an
  explicit, inspectable native-addon bootstrap.
