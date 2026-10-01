import { defineConfig } from 'vitest/config';

// Unit tests: no database or network. Test-only config values (never used at runtime).
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://test:test@localhost:5432/test',
      JWT_SECRET: 'unit-test-jwt-secret-0123456789abcdefghijkl',
      REFRESH_TOKEN_PEPPER: 'unit-test-refresh-pepper-0123456789abcdefgh',
      CSRF_SECRET: 'unit-test-csrf-secret-0123456789abcdefghijk',
      SEED_DEFAULT_PASSWORD: 'unit-test-password-long',
    },
  },
});
