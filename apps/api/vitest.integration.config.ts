import { defineConfig } from 'vitest/config';

// Integration tests run against a live stack: `docker compose up` (API_URL defaults to the gateway).
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
