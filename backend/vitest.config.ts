import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one database; a single fork keeps their writes
    // from interleaving.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
});
