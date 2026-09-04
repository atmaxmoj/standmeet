// visitor-composer-receipt.spec.ts —— F-A-42. **When does a turn actually end**, and what unlocks the input.
//
// Measured in the real environment (prod, real model): after the answer is fully written the input
// stays locked for 10-26 seconds, while it looks completely ready
// (`›` + `ask…` + `ASK ↵`). Type 20 characters into it, not one lands. The unlock moment always
// follows the HTTP response body closing (within 30ms) —— the client treats the **stream's lifetime**
// as the **turn's lifetime**.
//
// The product itself documents which frame is the receipt (`agent-core/src/agent-turn.ts:125`):
//   "The tail frame renders nothing itself, but **whether it arrived** is this turn's only reliable 'done' receipt"
// The `done` frame is emitted at `sink.Done()`; the later `emitEpilogue` is a real LLM call (ghost),
// so the stream is of course still open. The design is right; the bug is that nobody consumes that receipt ([[nonunique-signal-not-a-receipt]]).
//
// **The stand-in must be slow, or this seam simply does not exist in e2e** ([[stand-in-is-politer-than-reality]]):
// the mock's ghost call is instantaneous → the "turn wrapped up, stream still open" window collapses to 0 → the guard passes on the broken code anyway.
// So `scriptMockGhost` gains a `delayMs` that slows only the epilogue call, not the answer.
//
// The criterion is always written as **"can a person type here"** (`toBeEditable`), never "is some class present":
// the price the visitor pays is whether the characters they type land.
//
// RED (before the fix):
//   · Case 1 —— the answer is long rendered, but the input stays disabled through the 6 seconds of epilogue → not editable within 2s, red.
//   · Case 2 —— the input is disabled while a turn is in flight, and typed characters are lost → red.
//   · Case 3 —— `use-chat.ts`'s `ask()` does a bare `return` while pending, so the second question is silently dropped → red.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockGhost, scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'composer-receipt@example.com',
  password: 'the-receipt-is-the-done-frame-1',
  handle: 'receiptowner',
  fullName: 'Receipt Owner',
};
const CODE = 'RECEIPT-01';

// The epilogue must be slow enough to be a visibly dead wait, but not so slow it drags the case down. 6s = a scaled-down stand-in for the real 10-26s.
const EPILOGUE_MS = 6_000;
// The unlock must happen within this window after the receipt arrives. The 1.5s is for rendering, not for waiting on the stream.
const UNLOCK_WINDOW_MS = 1_500;
// A turn stays "answering" this long —— the visitor thinking of the next question during that time is the norm, not an edge case.
const IN_FLIGHT_MS = 6_000;

const WP = {
  waypoint_id: 'grasp-alpha', description: 'understand Alpha',
  weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
};
// The window only exists once the epilogue actually runs —— the role needs a waypoint, or the ghost step is skipped entirely.
const POLICY_GHOST = {
  text: 'What made you take on Alpha?',
  target_waypoint: 'grasp-alpha',
  follows_from: 'you mentioned Alpha',
  is_bridge: false,
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('F-A-42 · 一轮的结束认在 done 回执上，不认在字节流上', () => {
  test('答案落地就能接着问 —— 不等 epilogue 把流关掉', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const answerTag = await scriptMockReplyText(req, 'Alpha is the thing I shipped.');
    const ghostTag = await scriptMockGhost(req, POLICY_GHOST, { delayMs: EPILOGUE_MS });
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`what did you ship${answerTag}${ghostTag}`);
    await input.press('Enter');

    // The answer arriving = this turn is over as far as the visitor is concerned. The 6 seconds after that are the server generating the ghost, which is none of their concern.
    await expect(page.getByTestId('answer-body'), '答案落地')
      .toContainText('Alpha is the thing I shipped', { timeout: 20_000 });

    await expect(input, '答案落地之后输入框必须立刻能用（红：要等 epilogue 关流）')
      .toBeEditable({ timeout: UNLOCK_WINDOW_MS });

    // The ghost still arrives —— unlocking early does not mean dropping the epilogue (don't trade one bug for another).
    await expect(input, 'epilogue 的 ghost 照旧到达')
      .toHaveAttribute('data-ghost', POLICY_GHOST.text, { timeout: 15_000 });
  });

  test('答的过程中打的字不会被吃掉', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    // The answer itself must also be slow —— otherwise the "turn in flight" window simply does not exist in e2e, and this assertion cannot fail.
    const answerTag = await scriptMockReplyText(
      req, 'Still writing that one out.', { delayMs: IN_FLIGHT_MS });
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`tell me about Alpha${answerTag}`);
    await input.press('Enter');

    // While the previous turn is still in flight, the visitor thinks of the next question and starts typing —— the product must not grey out and swallow it
    // (global rule 10: accept the request and queue it, don't grey it out).
    await expect(input, '一轮在飞时输入框仍可编辑（红：disabled）')
      .toBeEditable({ timeout: 3_000 });
    await input.fill('and who else worked on it');
    await expect(input, '打进去的字留在框里').toHaveValue('and who else worked on it');
  });

  test('答的过程中按下发送 → 排队，不是丢掉', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const firstTag = await scriptMockReplyText(
      req, 'The first answer.', { delayMs: IN_FLIGHT_MS });
    const secondTag = await scriptMockReplyText(req, 'The second answer.');
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await input.fill(`first question${firstTag}`);
    await input.press('Enter');

    await expect(input).toBeEditable({ timeout: 3_000 });
    await input.fill(`second question${secondTag}`);
    await input.press('Enter');

    // Both turns must land. The red state is the second question being silently swallowed by `ask()`'s `if (pending) return`:
    // the visitor sees themselves press send, the box clears, and then nothing happens.
    await expect(page.getByTestId('answer-body'), '排队的那一问也答了')
      .toHaveCount(2, { timeout: 40_000 });
    await expect(page.getByTestId('answer-body').last())
      .toContainText('The second answer', { timeout: 20_000 });
  });
});

async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'receipt-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, { title: 'Alpha', body: 'Alpha.', path: 'alpha' });
  const role = await createRole(request, csrf, {
    name: 'receipt-role', description: 'composer receipt spec',
    corpus_uris: ['wiki://**', 'output://**'], waypoints: [WP],
  });
  await createCode(request, csrf, { code: CODE, label: 'receipt', assumed_role_id: role.id });
  await request.dispose();
}
