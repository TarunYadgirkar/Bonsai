import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Resolve entry points relative to this file, not the caller's cwd — CI runs it from the repo root.
const root = dirname(fileURLToPath(import.meta.url));

// The engine reads process.env for provider keys; in the browser there are none, so define them
// as undefined — providerName() resolves to 'mock' and the extractive compiler runs locally with
// zero network. MV3 CSP bans eval, and the engine is plain TS, so IIFE bundles satisfy it.
const define = {
  'process.env.ANTHROPIC_API_KEY': 'undefined',
  'process.env.OPENAI_API_KEY': 'undefined',
  'process.env.XAI_API_KEY': 'undefined',
  'process.env.NODE_ENV': '"production"',
};

const common = {
  bundle: true,
  target: 'chrome116',
  outdir: 'dist',
  absWorkingDir: root,
  sourcemap: true,
  define,
  logLevel: 'info',
};

const builds = [
  { ...common, entryPoints: ['src/content.ts', 'src/sidepanel.ts'], format: 'iife' },
  { ...common, entryPoints: ['src/sw.ts'], format: 'esm' },
];

if (process.argv.includes('--watch')) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[bonsai] watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log('[bonsai] built dist/');
}
