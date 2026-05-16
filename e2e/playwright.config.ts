import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env.local for local runs (e2e repo root)
dotenv.config({ path: path.join(__dirname, '.env.local') });

if (!process.env.BASE_URL) throw new Error('BASE_URL env var is required');
const BASE_URL = process.env.BASE_URL;

// Artifacts go under test-results/
const outputDir = path.join(process.cwd(), 'test-results', 'playwright');

export default defineConfig({
  globalSetup: './test/global-setup.ts',
  globalTeardown: './test/global-teardown.ts',
  testDir: './test',

  // Timeouts
  // 90s per test gives enough headroom for slower CI / machines under load
  // while still catching genuinely hung tests.
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // Parallelism
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  workers: 1,

  // Retries
  retries: process.env['CI'] ? 2 : 1,

  // Reporting — JSON goes to a fixed absolute path
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(process.cwd(), 'test-results', 'results.json') }],
  ],

  // Output (test artifacts: traces, screenshots, videos)
  outputDir,

  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /setup\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /setup\.spec\.ts/,
    },
  ],

  // Skip webServer when BASE_URL points to an external host (e.g. docker compose)
  ...(BASE_URL.includes('localhost')
    ? {
        webServer: {
          command: 'npm run dev',
          url: BASE_URL,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});
