// visitor-chat-sse-drop-auto-recovers.spec.ts — K (owner-reported): a visitor's chat SSE drops
// mid-answer (network jitter). Today that needs a MANUAL refresh to recover; it shouldn't.
//
// The backend runs the turn on a detached context (agent_turn.go:136) and persists it even after
// the client's connection dies (proven at the API level by
// conversation-midstream-disconnect-persists.spec.ts). This spec proves the CLIENT half: on a
// mid-stream drop the browser pulls that persisted answer back on its own — no refresh, no
// regeneration — and shows the complete answer.
//
// Drop simulation without touching the backend generation: intercept POST /agent/turn, let the
// REAL turn run and persist via route.fetch() (so the full answer lands in the conversation
// table), but hand the browser only a truncated, unterminated stream — one text frame carrying
// just HEAD, no `done`. The client sees a half-answer with no terminator → recovery kicks in →
// polls GET /conversations/{id} → replaces the half with the persisted whole.
//
// The assertion can go RED: TAIL only ever reaches the screen through recovery (it was never in
// the truncated stream the browser received). If recovery regressed, TAIL never appears.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'ssedrop@example.com', password: 'correct-horse-battery-staple',
  handle: 'ssedrop', fullName: 'SSE Drop Owner',
};

const CODE = 'SSEDROP-001';

// HEAD is all the browser ever receives over the (truncated) live stream; TAIL is only in the
// persisted answer the backend produced, so it can reach the screen ONLY through recovery.
const HEAD = 'The deterministic state holder';
const TAIL = 'and-this-only-comes-back-through-recovery';
const FULL_ANSWER = `${HEAD} keeps every fact in one place, ${TAIL}.`;

async function setupOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'ssedrop-role', description: 'sse drop spec', corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'ssedrop', assumed_role_id: role.id });
  await request.dispose();
}

// truncatedStream — one text frame with HEAD, and deliberately NO `done`: exactly what the
// browser sees when the connection dies mid-answer.
function truncatedStream(): string {
  return `event: text\ndata: ${JSON.stringify({ delta: HEAD })}\n\n`;
}

test.describe('visitor chat · a dropped SSE auto-recovers the persisted answer (K)', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupOwner(playwright);
  });

  test('mid-stream drop → the full persisted answer comes back without a manual refresh',
    async ({ page, request }: { page: Page; request: APIRequestContext }) => {
      test.setTimeout(120_000);
      await enterCodeSession(page, CODE);

      const tag = await scriptMockReplyText(request, FULL_ANSWER);
      const userMessage = `what are you working on ${tag}`;

      // Intercept only the turn: run the real generation (persists the full answer) but give the
      // browser a truncated, unterminated stream. Later turns/polls are untouched.
      let cut = false;
      await page.route('**/api/v1/agent/turn', async (route) => {
        if (cut) { await route.continue(); return; }
        cut = true;
        const real = await route.fetch(); // the backend turn runs to completion + persists
        await real.text();
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
          body: truncatedStream(),
        });
      });

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(userMessage);
      await input.press('Enter');

      // The half that streamed in shows first…
      await expect(page.getByTestId('answer-body')).toContainText(HEAD, { timeout: 30_000 });
      // …then recovery replaces it with the whole persisted answer — TAIL proves it, because TAIL
      // was never in the stream the browser received.
      await expect(page.getByTestId('answer-body')).toContainText(TAIL, { timeout: 30_000 });
      // And it did NOT wrap up as a cut/unfinished turn.
      await expect(page.getByTestId('answer-partial-notice')).toHaveCount(0);
    });
});
