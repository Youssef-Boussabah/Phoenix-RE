import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@phoenix/evidence': fileURLToPath(new URL('./packages/evidence/src/index.ts', import.meta.url)),
      '@phoenix/toolkit': fileURLToPath(new URL('./packages/toolkit/src/index.ts', import.meta.url)),
      '@phoenix/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/*.e2e.test.ts'],
        },
      },
      { extends: true, test: { name: 'integration', include: ['packages/evidence/test/**/*.int.test.ts'] } },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'packages/contracts/src/**/*.ts',
        'packages/toolkit/src/**/*.ts',
        'packages/evidence/src/**/*.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        'packages/evidence/src/**': { lines: 85 },
        'packages/contracts/src/**': { lines: 95, statements: 95, functions: 95, branches: 95 },
        'packages/toolkit/src/**': { lines: 85, statements: 85, functions: 85, branches: 85 },
      },
    },
  },
});
