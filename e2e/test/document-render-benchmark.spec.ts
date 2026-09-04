// document-render-benchmark.spec.ts —— a render-time smoke for each markdown element
// on the wiki landing. Not a strict perf gate (CI is too jittery); a loose ceiling catches
// "suddenly takes several seconds longer" regressions; timing is written to stdout for the owner to watch the trend.
//
// It used to bench the /dev/chat-render fixture path; after G-6 removed the dev route it switched to
// the real prod path /wiki/<path>. Note: the wiki landing carries its own SessionStrip + layout,
// so it has more page-chrome overhead than plain ChatMarkdown, and the threshold is loosened.

import { test, expect, type APIRequestContext, type Browser, type Page } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

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
    path: 'bench-markdown',
    body: '# Heading\n\n**bold** text\n\n- a\n- b',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="wiki-body"] h1').waitFor();
    },
    ceilMs: 8_000,
  },
  {
    name: 'gfm (table)',
    path: 'bench-gfm',
    body: '| a | b |\n| - | - |\n| 1 | 2 |',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="wiki-body"] table').waitFor();
    },
    ceilMs: 8_000,
  },
  {
    name: 'katex inline + display',
    path: 'bench-katex',
    body: 'Inline $E = mc^2$\n\n$$\n\\int_0^1 x dx\n$$',
    awaitSelector: async (page) => {
      await page.locator('[data-testid="wiki-body"] .katex-display').waitFor();
    },
    ceilMs: 8_000,
  },
  {
    name: 'mermaid (lazy ~600KB)',
    path: 'bench-mermaid',
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
      console.log(`[bench] ${b.name} : ${elapsed}ms`);
      expect(elapsed).toBeLessThan(b.ceilMs);
    });
  }
});

async function measure(browser: Browser, b: Bench): Promise<number> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const t0 = Date.now();
  await goto(page, `/wiki/${b.path}`);
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
    // address-tree derived: title = path slug (single segment, root), leaf tree path = slug(title) = b.path,
    // so the public URL /wiki/<b.path> resolves to this one.
    const { wikiID } = await seedWiki(request, token, sid, {
      body: b.body, title: b.path, path: b.path,
    });
    await publishEntry(request, token, sid, {
      genre: 'wiki', id: wikiID, excerpt: `${b.name} bench fixture.`,
    });
  }
}
