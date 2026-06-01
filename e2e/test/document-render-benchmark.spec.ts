// document-render-benchmark.spec.ts —— wiki landing 上各 markdown 元素
// 的渲染耗时 smoke。不是严格 perf gate (CI 抖动太大)，宽松上限把"突然
// 多花几秒"这种回归抓出来；timing 写 stdout 给 owner 看趋势。
//
// 之前是 bench /dev/chat-render fixture path；G-6 删掉 dev route 后切到
// 真 prod 路径 /wiki/<path>。注：wiki landing 自带 SessionStrip + 布局，
// 跟纯 ChatMarkdown 比多了 page chrome 开销，阈值放宽。

import { test, expect, type APIRequestContext, type Browser, type Page } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

interface Bench {
  name: string;
  path: string;
  body: string;
  awaitSelector: (page: Page) => Promise<void>;
  ceilMs: number;
}

const BENCHES: readonly Bench[] = [
  {
    name: 'markdown (基础)',
    path: 'bench/markdown',
    body: '# Heading\n\n**bold** text\n\n- a\n- b',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="wiki-body"] h1').waitFor();
    },
    ceilMs: 8_000,
  },
  {
    name: 'gfm (table)',
    path: 'bench/gfm',
    body: '| a | b |\n| - | - |\n| 1 | 2 |',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="wiki-body"] table').waitFor();
    },
    ceilMs: 8_000,
  },
  {
    name: 'katex inline + display',
    path: 'bench/katex',
    body: 'Inline $E = mc^2$\n\n$$\n\\int_0^1 x dx\n$$',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="wiki-body"] .katex-display').waitFor();
    },
    ceilMs: 8_000,
  },
  {
    name: 'mermaid (lazy ~600KB)',
    path: 'bench/mermaid',
    body: '```mermaid\ngraph LR; A-->B\n```',
    awaitSelector: async (page) => {
      await page.getByTestId('mermaid-svg').locator('svg').waitFor();
    },
    ceilMs: 15_000,
  },
];

test.describe('document render benchmark · wiki landing 渲染耗时 smoke', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedBenchFixtures(request);
    await request.dispose();
  });

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
  await page.goto(`/wiki/${b.path}`);
  await b.awaitSelector(page);
  const elapsed = Date.now() - t0;
  await ctx.close();
  return elapsed;
}

async function seedBenchFixtures(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'bench-seed');
  const sid = await initMCP(request, token);
  for (const b of BENCHES) {
    const { wikiID } = await seedWiki(request, token, sid, {
      body: b.body, title: `Bench · ${b.name}`, path: b.path,
    });
    await callTool<unknown>(request, token, sid, 'seo.set_wiki_slug', {
      wiki_id: wikiID, seo_slug: b.path,
      seo_description: `${b.name} bench fixture.`, seo_indexed: true,
    });
  }
}
