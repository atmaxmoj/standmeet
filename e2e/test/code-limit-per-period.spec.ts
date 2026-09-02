// code-limit-per-period.spec.ts —— how much a single code can spend per period (a
// renewable rate gate).
//
// Background (2026-09-01 plan): the embed widget runs on public sites, and many visitors
// share the same code. Neither existing cap is enough: max_turns_per_session is
// **per-session** (resets whenever a visitor opens a new session), and gas is a **total**
// (needs the owner to manually top it up once spent). What's missing is a
// **per-period, auto-refilling** bucket — "this code gets at most N turns / N gas per
// hour", refilling automatically once the period rolls over. Without it, a public embed
// code can be farmed nonstop, all day.
//
// Contract (true once implemented): a code with limit_per_period={amount, unit,
// period_seconds} set →
//   · lets requests through until the cumulative count within the window (**across every
//     session on this code**, not per session) reaches amount;
//   · once reached, refuses (403 period_limit_reached) until the window rolls forward.
// The bucket is **per-code**: the embed caps this code's total per period, regardless of
// which visitor or which session made the request.
//
// This test counts in turns (easier to count than gas). The window is a rolling one: it
// counts this code's turns over the past period_seconds.
// RED (before implementation): without this gate, the third turn still returns 200.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'periodlimit@example.com', password: 'correct-horse-battery-staple',
  handle: 'periodlimit', fullName: 'Period Limit Owner',
};
const CODE = 'RATE-2PH'; // 2 turns per hour

async function createCodeRaw(
  request: APIRequestContext, csrf: string, body: Record<string, unknown>,
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/codes`, {
    headers: { 'X-Csrftoken': csrf }, data: body,
  });
  if (res.status() !== 201) throw new Error(`create code: ${res.status()}`);
}

// runTurn —— opens a session with this code and runs one turn, returning the HTTP
// status. A fresh session every time: proves the bucket is per-code, not per-session.
async function runTurn(request: APIRequestContext, msg: string): Promise<number> {
  const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
  const tag = await scriptMockReplyText(request, 'A short reply.');
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { system: 'You are the owner.', user_message: `${msg}${tag}`, conversation_id: sess.conversation_id },
  });
  return res.status();
}

test.describe('code · a per-period limit caps the code across all its sessions', () => {
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'rate-role', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    await createCodeRaw(request, csrf, {
      code: CODE, label: 'rate', assumed_role_id: role.id,
      limit_per_period: { amount: 2, unit: 'turns', period_seconds: 3600 },
    });
  });
  test.afterAll(async () => { await request.dispose(); });

  test('the first N turns within the period are allowed, the N+1th is refused',
    async () => {
      // Every call is a **new session**, sharing this code's period bucket.
      expect(await runTurn(request, 'one '), '窗口内第 1 轮放行').toBe(200);
      expect(await runTurn(request, 'two '), '窗口内第 2 轮放行').toBe(200);
      // Turn 3: this code's quota for the hour is used up → refused.
      // max_turns_per_session can't catch this (every call is a new session).
      expect(await runTurn(request, 'three '),
        '同一张码窗口内第 3 轮必须被拒 —— 否则公开 embed 码会被不停地薅').toBe(403);
    });
});
