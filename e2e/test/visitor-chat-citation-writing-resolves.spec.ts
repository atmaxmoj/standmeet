// visitor-chat-citation-writing-resolves.spec.ts —— when a **writing** is cited, that link
// must **actually open**.
//
// Observed live (prod, sijie.xyz): clicking the citation under an answer opens
//   sijie.xyz/writing/writings/the-business-model-wedge  →  404
// and that was the instance's **only** public writing at the time — the entire public
// reading surface's entry point was broken.
//
// Root cause: two separate render sites each build the address as `/${c.genre}/${c.path}`,
// **treating the genre name as if it were the route name**. The genre is singular `writing`,
// the route is plural `/writings/[slug]`; and that writing's corpus path itself already
// carries a `writings/` prefix (that directory exists in the vault), so the two stack up
// into a double segment.
//
// Why this was never caught before: this whole family of assertions only ever covered wiki
// (`visitor-chat-citation-multi.spec.ts` asserts `/wiki/<path>`) — and wiki happens to be
// the one genre where the wrong formula **accidentally comes out right**. Two of the three
// genres got lucky, so every test stayed green and the defect only showed up on the third
// (same family as [[all-tests-are-failure-path]]: coverage happened to land exactly where
// it couldn't expose the problem).
//
// The criterion is **not string equality**, it's "**click** it, then a human sees the
// article". Asserting href equals some literal would still go green if I changed the formula
// to a different, consistently-wrong one ([[assertion-that-cannot-fail]]); reading the href
// and calling goto yourself sidesteps exactly the action a real visitor takes (this citation
// carries `target="_blank"`, a real click opens a new tab).
//
// RED (before the fix): the new tab that opens is Next's 404 page — the address is
// `/writing/writings/<slug>`.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'citation-writing@example.com',
  password: 'a-citation-that-cannot-be-followed-is-not-a-citation-1',
  handle: 'citeowner',
  fullName: 'Cite Owner',
};
const CODE = 'CITEWRITE-01';

const SLUG = 'the-business-model-wedge';
// This position in the corpus tree carries a `writings/` prefix — same as the vault.
// **This is exactly the segment that stacks into the 404**; without it this test case
// couldn't drive out that defect.
const CORPUS_PATH = `writings/${SLUG}`;
const TITLE = 'Attack the Business Model, Not the Feature List';

test.describe('引用一篇 writing 时，那条链接打得开', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    await initOwner(playwright);
  });

  test('点引用落在那篇文章上，不是 404', async ({ page }) => {
    test.setTimeout(120_000);
    await enterCodeSession(page, CODE);

    const tag = await scriptMockToolCall(page.request, {
      name: 'corpus_read', args: { path: CORPUS_PATH },
    });
    const input = page.getByTestId('chat-input-field');
    await input.fill(`what do you think about competing on features?${tag}`);
    await input.press('Enter');

    // references are collapsed by default — without expanding it first, a red would stop at
    // "citation row not visible", which is a drawer concern, not the defect this test case
    // is meant to drive ([[red-in-the-wrong-place]]).
    const refs = page.locator('[data-testid="citations"]', {
      has: page.locator(`[data-citation-path="${CORPUS_PATH}"]`),
    });
    await expect(refs, '这一轮引了那篇 writing').toBeVisible({ timeout: 30_000 });
    await refs.locator('summary').first().click();

    const row = refs.locator('[data-testid="citation-row"]').first();
    await expect(row, '引用行展开后看得见').toBeVisible({ timeout: 15_000 });

    // **Click it**, don't read the href and navigate there yourself.
    //
    // The latter sidesteps the action a real visitor actually takes: this citation carries
    // `target="_blank"`, a real click opens a new tab, and "read href + goto" would never
    // drive that path — if the link is covered by another element, a handler swallows the
    // default action, or the new window gets blocked, all three still go green. The
    // criterion has to be **what a human sees after clicking**.
    const [opened] = await Promise.all([
      page.waitForEvent('popup', { timeout: 15_000 }),
      row.click(),
    ]);
    await opened.waitForLoadState('domcontentloaded');

    await expect(opened.locator('body'), '点开落在那篇文章上')
      .toContainText(TITLE, { timeout: 15_000 });
    // The falsifiable half: only once the assertion above pins down "the article body is
    // really there" does this one stop being trivially true on an empty page.
    await expect(opened.locator('body'), '不是 Next 的 404 页')
      .not.toContainText('This page could not be found');
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'cite-writing-seed');
  const sid = await initMCP(request, apiToken);
  await callTool(request, apiToken, sid, 'writing_create', {
    slug: SLUG,
    title: TITLE,
    excerpt: 'Feature lists are downstream of the model that pays for them.',
    body_md: 'A feature list is the surface. The business model is what decides '
      + 'which features can exist at all, and it is the thing a competitor cannot copy cheaply.',
    cover_headline: 'wedge.', cover_hue: 'amber',
    tags: ['strategy'], publish: true,
  });
  await createCode(request, csrf, { code: CODE, label: 'citewrite' });
  await request.dispose();
}
