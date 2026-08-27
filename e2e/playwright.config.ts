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
      // 留痕那套**只**属于 mobile project。不排掉的话它会跟着每一次全量在桌面尺寸
      // 再跑一遍,产出一堆没人看的图,还把全量拖长。两个 project 的范围写成互斥的,
      // 这样"跑错了那一套"这件事没有发生的余地。
      testIgnore: /mobile-sweep\.spec\.ts/,
    },
    // mobile —— 手机视口下的截图留痕。
    //
    // 这里跑的**不是**功能套件,是 mobile-sweep 那一份截图留痕(见那个文件开头)。
    // 理由:响应式坏掉的样子断言看不见 —— 线上 admin 在 390px 上
    // `scrollWidth === clientWidth`、没有任何元素超过视口宽度、每一条现成断言照样绿,
    // 而正文被侧栏挤到只剩 158px。元素没有溢出,它们是**被压扁的**
    // ([[text-assertion-cannot-see-layout]])。判据只能是人眼,所以产出是图。
    //
    // 只换视口,**不开 isMobile / hasTouch**:响应式 CSS 的断点只看宽度,而模拟触摸会
    // 顺带改掉 hover、点击语义和 UA,把布局的问题和交互的问题混成一堆。要驱触摸那一档
    // 单独再开一个 project,别把两件事塞进一个。
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      testMatch: /mobile-sweep\.spec\.ts/,
    },
  ],
});
