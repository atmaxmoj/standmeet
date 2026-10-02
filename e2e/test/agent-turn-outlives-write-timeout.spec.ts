// agent-turn-outlives-write-timeout.spec.ts —— a visitor's answer that takes longer than the
// server's 30s write timeout still reaches the visitor.
//
// The turn extends its own write deadline (http.ResponseController) so a long turn is capped by its
// own budget, not by the server's 30s. Found 2026-10-02: the owner's live transcript tees the
// visitor's turn writer (v0.1.109), and that wrapper hid the real writer from the controller —
// "extend write deadline unsupported" in every turn's log, and any answer slower than 30s was cut
// off before it arrived.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'slow-turn@example.com', password: 'correct-horse-battery-staple',
  handle: 'slowturn', fullName: 'Slow Turn Owner',
};
const ANSWER = 'This answer took longer than half a minute to arrive.';

test('an answer slower than the 30s write timeout still reaches the visitor', async ({ playwright }) => {
  test.setTimeout(180_000);
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext({ timeout: 120_000 });
  await claim(request, findSetupToken(), OWNER);
  const visitor = await issueSession(request, { handle: OWNER.handle, mode: 'public', visitor_name: 'V' });
  const tag = await scriptMockReplyText(request, ANSWER, { delayMs: 35_000 });
  const res = await runVisitorChatTurn(request, visitor, `Take your time.${tag}`);
  expect(res.status()).toBe(200);
  expect(await res.text(), 'the whole answer arrived').toContain(ANSWER);
  await request.dispose();
});
