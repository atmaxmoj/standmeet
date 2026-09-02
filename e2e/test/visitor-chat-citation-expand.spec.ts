// visitor-chat-citation-expand.spec.ts -- G-3: a cited row is clickable, clicking it expands
// the original body inline. During corpus_read the backend already streams the body back
// (marshalKindBodyPath includes body); the frontend stores it in Citation.body, and clicking
// <details>/<summary> renders it.
//
// User story: visitor asks "tell me about lucerna" -> mock goes through corpus_search +
// corpus_read -> a cited row appears under "drawn from" -> clicking the lucerna row ->
// expands the wiki body text inline ("lucerna is a local-first knowledge tool I built.").

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';
const TARGET_PATH = 'projects/lucerna';
const TARGET_BODY = 'lucerna is a local-first knowledge tool I built.';

test.describe('citation row 可点 + inline 展开原文', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'citation-expand-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: TARGET_BODY, title: 'Lucerna', path: TARGET_PATH,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'citation expand spec',
    });
    await request.dispose();
  });

  test('visitor 问 → cited 行出现 → 是 link → 跳那篇 document 的公开页',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      // Mock is pure registration: the corpus_read of lucerna is what cites it.
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: TARGET_PATH },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${readTag}`);
      await input.press('Enter');

      // Wait for cited "references · N" to appear (cited comes from tool_completed events).
      // It's now collapsed by default (like normal AI chat); click the references summary first to expand the list.
      const citations = page.getByTestId('citations');
      await expect(citations).toBeVisible({ timeout: 20_000 });
      await citations.locator('summary').first().click();

      // Lock onto the lucerna citation row.
      const row = page.locator(
        `[data-testid="citation-row"][data-citation-path="${TARGET_PATH}"]`,
      );
      await expect(row).toBeVisible({ timeout: 5_000 });

      // Clicking a citation = navigates to that document's public page on the owner's site:
      // link href = /<genre>/<path derived from the tree>, opens in a new tab. No longer
      // expands the body inline.
      await expect(row).toHaveAttribute('href', `/wiki/${TARGET_PATH}`);
      await expect(row).toHaveAttribute('target', '_blank');
      // (This used to assert citation-body doesn't exist -- but that testid was removed long
      // ago, making toHaveCount(0) an eternally-true tautology, rot-E3. "A citation is an
      // outbound link, not an inline expansion" is now proven by the href/target above.)

      await ctx.close();
    });
});
