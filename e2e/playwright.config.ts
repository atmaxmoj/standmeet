import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 本地 .env.local 可覆盖 BASE_URL；CI / docker compose 通过 env 直接传。
dotenv.config({ path: path.join(__dirname, '.env.local') });

// BASE_URL 默认指向 backend 的 API root；启用 app/ 之后可改指 Next.js
// dev server，让 API 走 baseURL/api。
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8000';

const outputDir = path.join(process.cwd(), 'test-results', 'playwright');

export default defineConfig({
  testDir: './test',

  timeout: 30_000,
  expect: { timeout: 5_000 },

  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,

  reporter: [
    ['list'],
    ['json', { outputFile: path.join(process.cwd(), 'test-results', 'results.json') }],
  ],

  outputDir,

  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
