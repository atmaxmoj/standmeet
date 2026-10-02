// visitor-cookie-slides-with-session.spec.ts —— the visitor's session cookie lives as long as the
// session it carries.
//
// A visitor session lasts 60 minutes and slides: every request extends it. The cookie that lets the
// server open a page for the visitor (sm_vsession) was written once, at issue, with the issue-time
// expiry, and never moved. So a visitor still writing after an hour (S2, a manuscript written
// together) reloaded the page and landed on the gate, while their session was alive. Found
// 2026-10-02 on sijie.xyz.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'cookie-slide@example.com', password: 'correct-horse-battery-staple',
  handle: 'cookieslide', fullName: 'Cookie Slide Owner',
};

async function cookieExpiry(request: APIRequestContext): Promise<number> {
  const c = (await request.storageState()).cookies.find((x) => x.name === 'sm_vsession');
  if (c === undefined) throw new Error('no sm_vsession cookie');
  return c.expires;
}

test('a visitor turn moves the session cookie\'s expiry along with the session', async ({ playwright }) => {
  test.setTimeout(120_000);
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const visitor = await issueSession(request, { handle: OWNER.handle, mode: 'public', visitor_name: 'V' });
  const issued = await cookieExpiry(request);
  // The session slides when a turn starts. The first answer takes 2s, so the second turn starts at
  // least 2s after issue: its expiry is later by more than the cookie's one-second precision.
  for (const delayMs of [2_000, 0]) {
    const tag = await scriptMockReplyText(request, 'Still here.', { delayMs });
    const res = await runVisitorChatTurn(request, visitor, `Are you there?${tag}`);
    expect(res.status()).toBe(200);
    await res.text();
  }
  expect(await cookieExpiry(request), 'the cookie expires later after the visitor was active')
    .toBeGreaterThan(issued);
  await request.dispose();
});
