// visitor-chat-history-restore.spec.ts —— #11: after the visitor reloads the page, the chat
// transcript (in-memory only) goes empty. On load, it pulls the Q&A of this conversation
// back by session token and rebuilds it, so a reload doesn't lose history.
//
// Story: a visitor enters a code session, asks a question, gets an answer → reload → that
// question + answer are still there.
//
// F-A-29: this turn **must** include a tool call. Previously the question it asked triggered
// no tool at all, so the aggregate carried `tool_calls: []`; but every real turn does
// retrieval — once F-A-28 stripped the retrieval call's `result` out of what's sent back to
// the visitor, the client schema failed to parse against a payload that actually "has a tool
// call," and the whole history got dropped — yet this case stayed green anyway. It was
// guarding "reload doesn't lose history" while only ever exercising a shape that doesn't
// exist in the real world.

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
const QUESTION = 'tell me about lucerna';

test.describe('刷新后对话历史恢复', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'history-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, { code: CODE, label: 'intro' });
    await request.dispose();
  });

  test('问一句 → reload → 那条问 + 答还在',
    async ({ browser }) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);

      // #28: the backend stores to the DB at the end of the /agent/turn stream (right before
      // `done`). Attach this SSE response listener before asking; res.finished() = stream
      // fully read = already stored — wait for it before reloading, otherwise the history
      // hasn't landed in the DB yet.
      const turnDone = page.waitForResponse((res) =>
        res.url().includes('/agent/turn') && res.status() === 200, { timeout: 20_000 });

      // A real turn always does retrieval first. The retrieval call's result gets stripped
      // out when it's sent down to the visitor (F-A-28), and the restore path must hold up
      // against that exact shape — these two tags are what bring it in.
      const searchTag = await scriptMockToolCall(page.request, {
        name: 'corpus_search', args: { query: 'lucerna' },
      });
      const readTag = await scriptMockToolCall(page.request, {
        name: 'corpus_read', args: { path: 'projects/lucerna' },
      });

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`${QUESTION}${searchTag}${readTag}`);
      await input.press('Enter');
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({
        timeout: 20_000,
      });
      const answerBefore = await page.locator('[data-testid="answer-body"]').innerText();
      await (await turnDone).finished();

      // reload: the in-memory transcript goes empty, the history endpoint pulls it back and rebuilds it.
      await page.reload();

      // That question + answer are restored.
      await expect(page.getByText(QUESTION)).toBeVisible({ timeout: 10_000 });
      const answerAfter = await page.locator('[data-testid="answer-body"]').innerText();
      expect(answerAfter.length).toBeGreaterThan(0);
      // Compare the answer body: normalize whitespace + strip the citation footer (live has
      // "REFERENCES · N", restore doesn't carry refs yet and keeps only the Q&A text — refs
      // hydration is left for later).
      const prose = (s: string) => s.replace(/\s+/g, ' ').replace(/REFERENCES.*$/i, '').trim();
      expect(prose(answerAfter)).toBe(prose(answerBefore));

      await ctx.close();
    });
});
