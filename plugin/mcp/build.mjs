import * as esbuild from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundle the stdio MCP server and its deps (@modelcontextprotocol/sdk, zod) into ONE committed
// file, so a marketplace install (which clones the repo without node_modules) can run it with a
// bare `node dist/server.mjs` — no install step. Rebuild with `node plugin/mcp/build.mjs` after editing server.mjs.
const root = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: ['server.mjs'],
  absWorkingDir: root,
  bundle: true,
  // The plugin routes with the REAL engine: alias the workspace package to its TS source and
  // let esbuild transpile it into the bundle. server.mjs is therefore not runnable unbundled.
  alias: { 'bonsai-engine': '../../packages/engine/src/index.ts' },
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // ESM bundles that pull in CJS deps need require() shimmed at the top of the output.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  outfile: 'dist/server.mjs',
  logLevel: 'info',
});

console.log('[bonsai-mcp] bundled dist/server.mjs');
