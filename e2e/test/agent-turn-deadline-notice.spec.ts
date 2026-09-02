// agent-turn-deadline-notice.spec.ts — F-A-44. What the product tells the visitor for
// the case where **the time wall is hit and even the rescue attempt runs out of time**.
//
// What it looks like in the real environment (prod, real model): ask a question that
// forces a three-level-deep crawl → the screen runs to `SEARCHED 4 · READ 64` → six
// minutes later that cell turns into
//   "The connection dropped before a reply came back. Please try asking again."
// The connection is fine — what's hit is the 300-second wall — and asking again just
// hits the same wall. The logs lay it out line by line: `forcing final answer
// evidence_items:24` → 60 seconds later `force-final generate: context deadline
// exceeded` → `answer_chars=0 recovered=false`.
//
// **Why this needs its own rig**: those two budgets are process-level (300s / 60s) and
// can't be shortened for a single test case in the default suite, so this path has
// never been driven. Run it with `make test-boundary` (AGENT_TURN_TIMEOUT=5 +
// FORCE_FINAL_TIMEOUT=3). Both must be short to reach "the rescue also failed to save
// it"; shortening only the first lets the rescue succeed — that's the happy path, not
// what this case is after.
//
// Without that rig, skip the whole group — a case that is always red only teaches
// people to ignore red (the lesson from those five captcha cases).
//
// RED (before the fix): `handleTerminalError` took the `em.sink.Error(err)` branch
// when the rescue attempt returned an empty string, so the frontend rendered the
// generic error copy, "connection dropped" appeared on screen, and `turn-notice` did
// not exist.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'deadline-notice@example.com',
  password: 'the-wall-states-its-own-reason-1',
  handle: 'deadlineowner',
  fullName: 'Deadline Owner',
};
const CODE = 'DEADLINE-01';
// Longer than both budgets (5s + 3s) — the model can't possibly reply in time this
// turn, hitting both walls.
const SLOWER_THAN_BOTH_WALLS_MS = 20_000;

test.describe('F-A-44 · 时间用完那一轮，产品说的是时间，不是「连接断了」', () => {
  test.beforeAll(async ({ playwright }) => {
    test.skip(process.env['BOUNDARY_TIGHT'] !== '1',
      '要短预算的台子 —— 走 `make test-boundary`');
    test.setTimeout(180_000);
    await initOwner(playwright);
  });

  test('撞墙的一轮说自己没时间了，并让访客问得更窄', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    // **Accumulate evidence first, then hit the wall** — that's the shape of the real
    // prod incident (`READ 64`, 24 pieces of evidence in hand), whereas "hit the wall
    // with zero tools" takes a different path (`no_answer`: nothing in hand at all).
    // Without this tool call, the test drives a different cell than the one it's
    // meant to.
    const toolTag = await scriptMockToolCall(req, {
      name: 'corpus_search', args: { query: 'boundary' },
    });
    // **Both registrations must be slow**: the rescue attempt after hitting the wall
    // is **a separate** call, and registering only one lets it get the default reply
    // and succeed instantly — that's the "rescue saved it" cell (the happy path), not
    // what this case is meant to drive.
    const tag = await scriptMockReplyText(
      req, 'never arrives', { delayMs: SLOWER_THAN_BOTH_WALLS_MS });
    const rescueTag = await scriptMockReplyText(
      req, 'the rescue never arrives either', { delayMs: SLOWER_THAN_BOTH_WALLS_MS });
    await req.dispose();

    await enterCodeSession(page, CODE);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`walk everything and tell me all of it${toolTag}${tag}${rescueTag}`);
    await input.press('Enter');

    const notice = page.getByTestId('answer-partial-notice');
    await expect(notice, '这堵墙自己说明了理由').toBeVisible({ timeout: 60_000 });
    await expect(notice, '说的是时间，而且给的下一步是「问得更窄」')
      .toContainText(/out of time/i);

    // The failure-detecting half: that false statement must never appear again.
    // The notice above is asserted present first (otherwise this assertion would also
    // pass while the page is still blank, [[negated-assertion-passes-while-absent]]).
    await expect(page.locator('body'), '不许再说「连接断了」—— 连接好好的')
      .not.toContainText(/connection dropped/i);
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'deadline-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'the boundary is engineered, not budgeted.', title: 'Boundary',
  });
  await createCode(request, csrf, { code: CODE, label: 'deadline' });
  await request.dispose();
}
