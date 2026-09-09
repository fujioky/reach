// vitest.config.ts
// Plan 03-01, Task 1 — Vitest test infrastructure.
// Mirrors tsconfig.json `@/*` → `./*` path alias so tests can import @/lib/*.
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname),
    },
  },
  test: {
    environment: 'node',
    // Only collect project test files; exclude vendored/sibling dirs
    // (e.g. .local/) that vitest
    // would otherwise crawl via default **/*.test.ts glob.
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['node_modules/**', '.local/**', '.next/**'],
  },
});
