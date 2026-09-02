// visitor-unfinished-turn-says-so.spec.ts —— F-A-32: when a turn **has no terminator**, the
// half it already streamed out must not pass itself off as a complete answer.
//
// What this looks like in the real environment: a question pushed to the budget boundary ran
// for 360 seconds; the model streamed a plan narration between tool calls (*"Let me peek at
// the remaining ~39 Level 2 notes to triage, then read them all."*), the stream cut off
// before `done` (ERR_INCOMPLETE_CHUNKED_ENCODING), and the client only treats it as an error
// when it received zero characters at all — so that half-finished plan got published as a
// completed answer, with no indication on screen, and the turn still counted as a success
// and got billed normally.
//
// The criterion is **whether the terminator frame arrived**, not "is there any text": the
// backend unconditionally sends `done` at the end of every path (agent_loop.go:152, including
// error paths), so its absence is a certain sign the turn never terminated. Because of that,
// this case doesn't need to actually sever a socket — it sends a legal SSE stream: two text
// frames, then **no** done. Missing a terminator frame is missing a terminator frame, however
// it happens.
//
// Both assertions are required:
//   1. the half-finished content is **still there** (a non-empty guard; this also fences off
//      a "fix" that clears all 43 citations and the body the moment an error happens);
//   2. there's a notice next to it saying it didn't finish.
// Asserting only #2 would also let through an implementation that swaps the whole screen for
// a single message on error — and that's just as much a loss for the visitor.

import { test, expect } from '@/fixtures/test';

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

const CODE = 'UNFIN-001';

// NARRATION —— the kind of thing the model says between tool calls. It reads like a
// sentence, so the "has text" criterion can't tell anything is wrong.
const NARRATION = 'Let me peek at the remaining notes to triage, then read them all.';

// unterminatedStream —— a legal SSE stream: two text frames, no done. In the real world
// this is what a severed stream looks like, and the missing terminator frame alone is enough
// to determine "the turn never finished."
function unterminatedStream(): string {
  return [
    `event: text\ndata: ${JSON.stringify({ delta: NARRATION })}\n\n`,
    `event: text\ndata: ${JSON.stringify({ delta: '' })}\n\n`,
  ].join('');
}

test.describe('没收尾的一轮要说出来', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'unfinished-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'unfinished', purpose: 'F-A-32 guard',
    });
    await request.dispose();
  });

  test('流在 done 之前结束 → 半截内容还在,而且旁边说它没说完', async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await enterCodeSession(page, CODE);

    // Only intercept this endpoint after the session is already established — otherwise
    // even the entry step itself would be altered.
    await page.route('**/api/v1/agent/turn', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: unterminatedStream(),
      });
    });

    const input = page.locator('[data-testid="chat-input-field"]');
    await input.fill('walk the whole link graph for me');
    await input.press('Enter');

    // 1) The half-finished content is still there — also a non-empty guard: first prove
    // this turn really did stream something out.
    await expect(page.getByTestId('answer-body')).toContainText(NARRATION, { timeout: 30_000 });

    // 2) And it doesn't pass itself off as a complete answer.
    await expect(page.getByTestId('answer-partial-notice')).toBeVisible({ timeout: 30_000 });

    await ctx.close();
  });
});
