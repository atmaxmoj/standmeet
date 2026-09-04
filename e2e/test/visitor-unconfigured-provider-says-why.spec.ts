// visitor-unconfigured-provider-says-why.spec.ts —— when this instance has no usable AI provider,
// the sentence the **visitor** reads.
//
// Observed (prod, sijie.xyz, just claimed, provider not configured yet): redeem a code, ask one question, and the screen shows
//   "The connection dropped before a reply came back. Please try asking again."
// while the backend in that same response sends
//   503 + `event: error` / `data: {"code":"owner_unconfigured",
//          "message":"This page doesn't have an AI provider set up yet."}`
// —— the connection is fine, the product **knows** the real reason and even wrote the human sentence, the visitor just can't read it.
// And "ask again" is useless advice: until the owner configures one, asking ten thousand times gives the same sentence.
//
// The bug is in the client layer: `agent-adapters.ts`'s `if (!res.ok) throw` discards the whole stream
// before the body is even read, so `agent-core` falls back to status-code guessing (401/403 says re-enter, everything else
// says "connection dropped, try again"). **The reason the server wrote itself always beats one guessed from a status code.**
//
// Why it went uncaught for so long: F-A-24 covers the **owner half of the same thing** (the dashboard must state it to their face),
// and its comment even copied that correct sentence as what the visitor reads —— yet no case ever asked the visitor.
// Two halves of one bug, only one half tested ([[all-tests-are-failure-path]]).
//
// RED (before the fix): `answer-body` holds "connection dropped", with not a word of the provider sentence.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, clearAIProviderKey, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'unconfigured-provider@example.com',
  password: 'the-server-already-wrote-the-sentence-1',
  handle: 'unconfiguredowner',
  fullName: 'Unconfigured Owner',
};
const CODE = 'NOPROVIDER-01';

test.describe('没有可用 provider 时，访客读到的是真实原因', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(120_000);
    await initOwner(playwright);
  });

  test('访客读到「没配 provider」，而不是「连接断了、再试一次」', async ({ page }) => {
    // The default 30s is shorter than the assertion's 60s below —— without widening it, the assertion's timeout can never be reached,
    // and the red reason becomes "case timed out", masking "is that sentence actually on the screen or not".
    test.setTimeout(120_000);
    await enterCodeSession(page, CODE);
    const input = page.getByTestId('chat-input-field');
    await input.fill('What is StandMeet?');
    await input.press('Enter');

    const answer = page.getByTestId('answer-body').last();
    // First pin down that the correct sentence is present. It is this case's **positive control**: the screen must actually hold a run of answer text
    // before the negative assertion below means anything ([[negated-assertion-passes-while-absent]]).
    await expect(answer, '产品说出真实原因：这台实例还没配 provider')
      .toContainText(/AI provider/i, { timeout: 60_000 });

    // The failing half: the false sentence must not appear —— the connection is fine, and "ask again" will never succeed.
    await expect(page.locator('body'), '不许说「连接断了」：连接好好的')
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
  await createCode(request, csrf, { code: CODE, label: 'noprovider' });
  // This state must be **produced**: claim always seeds a usable provider (seedDevAIProvider).
  // After clearing the key, every visitor's first question is turned back with a 503 —— exactly what a just-claimed instance on prod looks like.
  await clearAIProviderKey(request, { email: OWNER.email, password: OWNER.password });
  await request.dispose();
}
