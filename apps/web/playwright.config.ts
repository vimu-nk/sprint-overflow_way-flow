import { defineConfig, devices } from '@playwright/test';

/** E2E walkthrough (specs/17 §3). Runs against `pnpm dev` (5173) or the stack (E2E_BASE_URL=http://localhost:8080). */
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
