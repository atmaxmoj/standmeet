// visitor-chat-citation-multi.spec.ts -- G-3 follow-up: multiple dialogs, each carrying
// its own 1 citation row, each linking to a document's public page / collapsing on its
// own. `<details>` itself is a native element, but verifying "the citation rows of two
// dialog cards don't cross-contaminate state" still has value: toggling one must not
// affect the other, and the previous dialog's expanded state must persist once the next
// dialog appears.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

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
const LUCERNA = 'projects/lucerna';
const FAMILY = 'personal/family';

test.describe('多 dialog citation 各自 link 到 document 公开页', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'citation-multi-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is my local-first knowledge tool.',
      title: 'Lucerna', path: LUCERNA,
    });
    await seedWiki(request, token, sid, {
      body: 'my mother is from singapore, my dad from BC.',
      title: 'Family', path: FAMILY,
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'citation-multi spec',
    });
    await request.dispose();
  });

  test('两个 dialog 各 1 cited row → 各是 link,各自跳那篇 document',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      const input = page.locator('[data-testid="chat-input-field"]');
      // First turn: lucerna -- references are collapsed by default, so expand the list
      // containing the lucerna row first.
      // Mock is pure registration: the corpus_read of lucerna is what cites it.
      const lucernaTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: LUCERNA },
      });
      await input.fill(`tell me about lucerna${lucernaTag}`);
      await input.press('Enter');
      const lucernaRow = page.locator(
        `[data-testid="citation-row"][data-citation-path="${LUCERNA}"]`,
      );
      await expandRefsContaining(page, LUCERNA);
      await expect(lucernaRow).toBeVisible({ timeout: 20_000 });

      // Second turn: family -- wait for the input to be enabled again
      await expect(input).toBeEnabled({ timeout: 20_000 });
      const familyTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: FAMILY },
      });
      await input.fill(`tell me about your family${familyTag}`);
      await input.press('Enter');
      const familyRow = page.locator(
        `[data-testid="citation-row"][data-citation-path="${FAMILY}"]`,
      );
      await expandRefsContaining(page, FAMILY);
      await expect(familyRow).toBeVisible({ timeout: 20_000 });

      // Every citation is a link -> each jumps to that document's public page
      // (/<genre>/<tree-derived path>), independent of each other, and neither expands
      // its body inline anymore.
      await expect(lucernaRow).toHaveAttribute('href', `/wiki/${LUCERNA}`);
      await expect(familyRow).toHaveAttribute('href', `/wiki/${FAMILY}`);
      // (The citation-body redundancy was removed, rot-E3: the testid no longer exists;
      // the href alone proves each citation links out on its own.)

      await ctx.close();
    });
});

// expandRefsContaining -- references are collapsed by default; finds the references
// details containing the row for path, and clicks its summary to expand it, making that
// row visible.
async function expandRefsContaining(page: Page, path: string): Promise<void> {
  const refs = page.locator('[data-testid="citations"]', {
    has: page.locator(`[data-citation-path="${path}"]`),
  });
  await expect(refs).toBeVisible({ timeout: 20_000 });
  await refs.locator('summary').first().click();
}
