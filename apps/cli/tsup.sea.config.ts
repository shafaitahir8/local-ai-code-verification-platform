import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/sea-entry.ts'],
  outDir: 'dist/sea',
  outExtension: () => ({ js: '.cjs' }),
  format: ['cjs'],
  target: 'node24',
  platform: 'node',
  bundle: true,
  clean: true,
  dts: false,
  sourcemap: false,
  splitting: false,
  minify: true,
  noExternal: [/.*/],
});
