import { defineConfig } from 'tsup';

// Publish-time build only. The workspace still resolves `@bonsai/engine` from `./src/index.ts`
// (top-level `exports`), so this never runs for the app/extension — `prepublishOnly` invokes it,
// and `publishConfig.exports` points the tarball at the emitted `dist/`.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  // The root tsconfig sets `incremental`/`noEmit` for the app; the .d.ts emit needs neither.
  dts: { compilerOptions: { incremental: false, composite: false, noEmit: false } },
  sourcemap: true,
  clean: true,
});
