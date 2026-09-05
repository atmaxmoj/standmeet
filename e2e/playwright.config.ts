import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

// A local .env.local can override BASE_URL; CI / docker compose passes it directly via env.
dotenv.config({ path: path.join(__dirname, '.env.local') });

// BASE_URL is the Next.js app's entry point (v1 single-owner instance: a visitor opening the
// domain / lands on the public page, and pre-claim it server-side redirects to /setup?t=...).
// The microsite fixture in fixtures/test.ts does goto('/') before each spec starts;
// the spec body afterward only clicks the UI, **so goto appears in that one place across the whole e2e suite**.
const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:38127';

const outputDir = path.join(process.cwd(), 'test-results', 'playwright');

export default defineConfig({
  testDir: './test',

  // After the run, dump the backend container logs to test-results/backend.log. To diagnose
  // a failed test, read this file directly instead of ad-hoc tailing the compose log.
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
      // The screenshot-trace suite belongs **only** to the mobile project. If not excluded, it would
      // run again at desktop size on every full run, producing a pile of images no one looks at and
      // dragging out the full run. The two projects' scopes are written to be mutually exclusive,
      // so "running the wrong suite" has no room to happen.
      testIgnore: /mobile-sweep\.spec\.ts/,
    },
    // mobile —— screenshot traces under a phone viewport.
    //
    // What runs here is **not** the functional suite, it's the mobile-sweep screenshot trace (see that file's header).
    // Reason: a broken responsive layout is invisible to assertions —— live admin at 390px has
    // `scrollWidth === clientWidth`, no element exceeds the viewport width, and every existing assertion stays green,
    // while the body is squeezed to just 158px by the sidebar. The elements don't overflow, they are **squished**
    // ([[text-assertion-cannot-see-layout]]). The only criterion is the human eye, so the output is images.
    //
    // Only the viewport changes, **isMobile / hasTouch stay off**: responsive CSS breakpoints only look at width, while
    // emulating touch would also change hover, click semantics, and the UA, mixing layout problems and interaction
    // problems together. To drive the touch tier, open a separate project; don't cram the two into one.
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      testMatch: /mobile-sweep\.spec\.ts/,
    },
  ],
});
