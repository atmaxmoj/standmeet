// visitor-chat-throbber-clears.spec.ts —— the throbber is transient "turn in
// progress" feedback; it must disappear once the turn lands, replaced by the
// collapsed `searched · N entries` card.
//
// The bug reproduced: ConversationDeck rendered <ToolThrobbers> outside the pending
// gate, and withAnswer left toolStarted on the finalized dialog — so once the answer
// had fully arrived, that string of SEARCHING / PULLING UP / READING stayed frozen in
// the transcript sitting right beside the answer.
//
// Invariant: the moment the answer card (tool-card-corpus_search, only rendered when
// !pending) appears, the turn has landed, and at that point tool-throbbers must have
// count==0.

import { test, expect } from '@/fixtures/test';

import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

test.describe('throbber 在 turn 落地后清掉,不冻在 transcript 里', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'throbber-clears-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'throbber-clears spec',
    });
    await request.dispose();
  });

  test('答案落地后 throbber 消失,折叠的 searched 卡接管',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      // Pure-registration mock: the turn runs a tool only if the test scripts it.
      // The `searched` card (mcp-app-card-corpus_search) needs corpus_search to run;
      // the citation footer needs corpus_read. Register both — each fires on a
      // successive inference call in the same turn (single-shot per key).
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: 'projects/lucerna' },
      });
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${searchTag}${readTag}`);
      await input.press('Enter');

      // The collapsed retrieval-summary appearing (UX-10: retrieval no longer renders
      // a per-tool iframe card) + citation showing up = this turn genuinely retrieved
      // and answered.
      const searchCard = page.getByTestId('retrieval-summary');
      await expect(searchCard).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('citations')).toBeVisible();

      // Invariant: the throbber is a live-observation state, and disappears once the
      // turn finalizes and it gets cleared to null. toHaveCount(0) keeps retrying
      // until it disappears — under the old bug it never disappears, so this times
      // out and fails; once fixed, finalize clears it and this passes. It must never
      // be left frozen in the transcript sitting beside the answer.
      await expect(page.getByTestId('tool-throbbers')).toHaveCount(0, { timeout: 20_000 });

      await ctx.close();
    });
});
