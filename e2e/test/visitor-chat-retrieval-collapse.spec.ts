// visitor-chat-retrieval-collapse.spec.ts —— UX-10 guard: a turn with MANY corpus_*
// retrieval calls collapses into ONE summary row, not one ui:// iframe per call.
//
// Real-env finding UX-10: a real model does 8–12 corpus_search/corpus_read calls in a single
// turn; each rendered its own tall ui:// sandbox iframe, stacking into a long sparse column that
// buried the answer. The mock emits one tool_use per turn, so every existing spec only ever drove
// ONE card and never saw the stacking. This scripts 3 searches + 2 reads in one turn.
//
// RED before the fix: 3× mcp-app-card-corpus_search (+ read) iframes render, no retrieval-summary.
// GREEN after: exactly one retrieval-summary ("searched 3 · read 2"), zero corpus_* iframes.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'collapse@example.com', password: 'correct-horse-battery-staple',
  handle: 'collapseowner', fullName: 'Collapse Owner',
};

const CODE = 'INTRO-001';
const PATH = 'projects/lucerna';

test.describe('retrieval cards collapse (UX-10)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'collapse-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.', title: 'Lucerna', path: PATH,
    });
    await createCode(request, csrf, { code: CODE, label: 'intro', purpose: 'collapse spec' });
    await request.dispose();
  });

  test('many corpus_* calls in one turn → one summary row, no per-call iframes',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);

      // Script 3 searches + 2 reads for this one turn. Each tag rides in the message; the
      // agent loop fires them in order → 5 retrieval tool_completed entries this turn.
      let tags = '';
      for (let i = 0; i < 3; i += 1) {
        tags += await scriptMockToolCall(page.request, {
          name: 'corpus_search', args: { query: `lucerna ${i}` },
        });
      }
      for (let i = 0; i < 2; i += 1) {
        tags += await scriptMockToolCall(page.request, {
          name: 'corpus_read', args: { path: PATH },
        });
      }

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about lucerna${tags}`);
      await input.press('Enter');

      // One collapsed summary, showing the aggregate counts.
      const summary = page.getByTestId('retrieval-summary');
      await expect(summary).toBeVisible({ timeout: 20_000 });
      await expect(summary).toHaveCount(1);
      await expect(summary).toContainText('searched 3');
      await expect(summary).toContainText('read 2');

      // NO per-call retrieval iframe cards (the stacking is gone).
      await expect(page.getByTestId('mcp-app-card-corpus_search')).toHaveCount(0);
      await expect(page.getByTestId('mcp-app-card-corpus_read')).toHaveCount(0);

      // Citations still carry what was actually read.
      await expect(page.getByTestId('citations')).toBeVisible();
      await ctx.close();
    });
});
