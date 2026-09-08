import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  bundle: true,
  clean: true,
  dts: false,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  noExternal: [/^@verify\//],
  external: ['better-sqlite3', 'commander', 'drizzle-orm', /^drizzle-orm\//, 'yaml', 'zod'],
});
