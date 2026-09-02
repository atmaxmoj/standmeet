// visitor-chat-tool-cards.spec.ts -- G-4 / UX-10: after the AI calls a
// retrieval tool, the result collapses into one retrieval-summary line (not
// one ui:// card per call). Coverage:
//   1. corpus_search + corpus_read -> a single retrieval-summary
//      ("searched N · read M")
//   2. corpus_read does not render its own card (its content goes through
//      Citation; this was always the intent, and the ui:// path once
//      regressed on it)
//   3. calendar_book is skipped (G-7 takes over)
//
// The scale of the collapse is guarded in
// visitor-chat-retrieval-collapse.spec.ts (repeated retrieval doesn't stack).

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

test.describe('tool call 渲染成卡片', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'tool-cards-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'tool-cards spec',
    });
    await request.dispose();
  });

  test('visitor 问 → 检索折叠成一行 summary，corpus_read 不各渲卡，citation 仍在',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();

      await enterCodeSession(page, CODE);

      // Mock is pure registration: one corpus_search + one corpus_read this turn.
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: 'projects/lucerna' },
      });

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${searchTag}${readTag}`);
      await input.press('Enter');

      // Retrieval collapses to ONE summary row (UX-10) — "searched 1 · read 1".
      const summary = page.getByTestId('retrieval-summary');
      await expect(summary).toBeVisible({ timeout: 20_000 });
      await expect(summary).toContainText('searched 1');
      await expect(summary).toContainText('read 1');

      // Neither corpus_search nor corpus_read renders its own ui:// card (the read
      // card was the regressed one; the search card is now folded into the summary).
      await expect(page.getByTestId('mcp-app-card-corpus_search')).toHaveCount(0);
      await expect(page.getByTestId('mcp-app-card-corpus_read')).toHaveCount(0);

      // Citation still carries what was actually read.
      await expect(page.getByTestId('citations')).toBeVisible();

      await ctx.close();
    });
});
