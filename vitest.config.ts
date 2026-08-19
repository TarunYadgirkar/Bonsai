import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname), 'bonsai-engine': path.resolve(__dirname, 'packages/engine/src') },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'extension/test/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
