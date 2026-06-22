import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

// 本地 .env.local 可覆盖 BASE_URL；CI / docker compose 通过 env 直接传。
dotenv.config({ path: path.join(__dirname, '.env.local') });

// BASE_URL 是 Next.js app 的入口（v1 单 owner instance：访客打开域名 /
// 就是公开页，pre-claim 时 server-side redirect 到 /setup?t=...）。
// fixtures/test.ts 的自定义 page fixture 在每个 spec 开始前 goto('/')；
// spec body 之后只点 UI，**整套 e2e 里 goto 只出现在那一处**。
const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:38127';

const outputDir = path.join(process.cwd(), 'test-results', 'playwright');

export default defineConfig({
  testDir: './test',

  // 跑完 dump backend container 日志到 test-results/backend.log。诊断失败
  // 的 test 不用 ad-hoc tail compose log，直接读这个文件。
  globalTeardown: path.join(__dirname, 'global-teardown.ts'),

  timeout: 30_000,
  expect: { timeout: 5_000 },

  // fullyParallel MUST stay false. The whole suite shares ONE owner instance, and
  // many specs' beforeAll calls resetInstance() (truncate + re-claim, which wipes
  // every access code). fullyParallel:true treats each test as an independently
  // scheduled unit — even at workers:1 it won't keep a file's tests contiguous, so
  // a sibling file's resetInstance can fire BETWEEN another spec's tests, yanking
  // the shared code out from under a live visitor session → the page reverts to
  // /gate mid-test (a nondeterministic flake; e.g. visitor-cancel-booking). With
  // fullyParallel:false + workers:1 each file runs beforeAll→tests→afterAll as one
  // contiguous block, so resetInstance can never wipe a spec mid-flight. workers:1
  // is already mandatory for the same shared-instance reason, so this costs no speed.
  fullyParallel: false,
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
