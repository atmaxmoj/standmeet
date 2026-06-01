// chat-render-benchmark.spec.ts —— ChatMarkdown 渲染各类元素的"时间"
// smoke test。不是严格 perf gate（CI 抖动太大），用宽松上限把"突然多花
// 几秒"这种回归抓出来；timing 写 stdout 给 owner 看趋势。
//
// 用 /dev/chat-render?fixture=* 静态 fixture，浏览器冷启 (newContext)
// 测从 navigate 到目标元素 first visible 之间的 wall-clock。各种 fixture
// 量级：markdown / gfm / katex / mermaid / xss。

import { test, expect, type Browser, type Page } from '@/fixtures/test';

interface Bench {
  name: string;
  path: string;
  awaitSelector: (page: Page) => Promise<void>;
  // 宽松阈值：mermaid 包 ~600KB lazy load + render，给 12s；其余 5s 够。
  ceilMs: number;
}

const BENCHES: readonly Bench[] = [
  {
    name: 'markdown (基础)',
    path: '/dev/chat-render?fixture=markdown',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="render-out"] h1').waitFor();
    },
    ceilMs: 5_000,
  },
  {
    name: 'gfm (table + del + autolink)',
    path: '/dev/chat-render?fixture=gfm',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="render-out"] table').waitFor();
    },
    ceilMs: 5_000,
  },
  {
    name: 'katex inline + display',
    path: '/dev/chat-render?fixture=katex',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="render-out"] .katex-display').waitFor();
    },
    ceilMs: 5_000,
  },
  {
    name: 'mermaid (lazy ~600KB)',
    path: '/dev/chat-render?fixture=mermaid',
    awaitSelector: async (page) => {
      await page.getByTestId('mermaid-svg').locator('svg').waitFor();
    },
    ceilMs: 12_000,
  },
];

test.describe('chat render benchmark · 渲染耗时 smoke', () => {
  for (const b of BENCHES) {
    test(`${b.name} 渲染 < ${b.ceilMs}ms`, async ({ browser }) => {
      const elapsed = await measure(browser, b);
      // eslint-disable-next-line no-console
      console.log(`[bench] ${b.name} : ${elapsed}ms`);
      expect(elapsed).toBeLessThan(b.ceilMs);
    });
  }
});

async function measure(browser: Browser, b: Bench): Promise<number> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(b.path);
  await b.awaitSelector(page);
  const elapsed = Date.now() - t0;
  await ctx.close();
  return elapsed;
}
