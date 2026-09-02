// gas-public-spend-is-metered.spec.ts — the owner's spend cap must actually cap
// anonymous/public visitors.
//
// pentest 2026-09-01: a session with no provider specified (public / anonymous)
// **falls back to the owner's default provider** at turn time and really spends
// money. But its session's provider_id stays an empty string, so:
//   · the usage row's provider_id is empty → gas accounting summed per-provider never
//     counts this spend;
//   · the gas gate's condition is `metered && provider_id != ""` → it never fires for
//     public sessions.
// Net effect: even if the owner metered the default provider, nothing stops an
// anonymous visitor from burning their key.
//
// After the fix (freeze an empty provider to the owner's default provider's id at
// session-issue time), these two hold:
//   ① a public turn's usage row carries the default provider's id (no longer empty);
//   ② once the public role is metered + the default provider is given only a few
//      tokens, a second public turn is blocked by exhaustion.
//
// RED (before the fix): the usage row's provider_id is empty; the exhaustion gate
// never fires for public, and a second turn still returns 200.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken, execSQL, querySQL } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'gasmeter@example.com', password: 'correct-horse-battery-staple',
  handle: 'gasmeter', fullName: 'Gas Meter Owner',
};

async function publicTurn(request: APIRequestContext, msg: string): Promise<number> {
  const sess = await issueSession(request, { handle: OWNER.handle, mode: 'public', visitor_name: 'V' });
  const tag = await scriptMockReplyText(request, 'A recap of what we discussed today.');
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers: { Authorization: `Bearer ${sess.session_token}`, 'Content-Type': 'application/json' },
    data: { system: 'You are the owner.', user_message: `${msg}${tag}`, conversation_id: sess.conversation_id },
  });
  return res.status();
}

test.describe('gas · an anonymous/public visitor spends the owner default provider, and it is metered', () => {
  let request: APIRequestContext;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await loginAPI(request, OWNER.email, OWNER.password);
  });
  test.afterAll(async () => { await request.dispose(); });

  test('a no-code turn attributes its usage to the default provider (not an empty provider_id)',
    async () => {
      expect(await publicTurn(request, 'hello '), 'public turn runs on the owner key').toBe(200);

      const defaultID = querySQL(`SELECT id FROM owner_providers WHERE is_default`);
      expect(defaultID, '前置：实例有一条默认 provider').not.toBe('');
      // Before the fix this was an empty string — the default key's money was spent,
      // but the usage was attributed to no provider at all.
      const attributed = querySQL(
        `SELECT provider_id FROM inference_usage ORDER BY created_at DESC LIMIT 1`,
      );
      expect(attributed,
        '匿名 turn 的用量必须记在它实际花掉的那条默认 provider 上，否则 gas 记账看不见它')
        .toBe(defaultID);
    });

  test('once the owner meters the public tier and the default tank runs low, a public turn is refused',
    async () => {
      // The owner's intent: meter the public role, and leave the default provider
      // with only 1 token. This edits the database directly to set up that
      // precondition (there is no API to "run the tank down to almost empty", and
      // there shouldn't be one).
      //
      // gas=1 rather than dozens: the gate checks "before write, if Remaining>0 then
      // allow" (the last turn can overspend — knowing exactly how much a turn will
      // cost before it answers is impossible, so staying under one token isn't
      // achievable). So to get the **next** turn blocked, the tank must hold less
      // than **one** turn's cost. Leaving 1 means a single turn drains it.
      execSQL(`UPDATE roles SET gas_metered = true WHERE name = 'public'`);
      execSQL(`UPDATE owner_providers SET gas_tokens = 1, gas_filled_at = now() WHERE is_default`);

      // The first public turn is allowed (tank > 0), and it alone drains the 1 token
      // (the overspend is persisted).
      expect(await publicTurn(request, 'first '), '油还有时第一次放行').toBe(200);
      // The second turn must be blocked by exhaustion — this is exactly the gate that
      // never fired for public before the fix.
      // gas_exhausted returns 403 (not the rate-limit's 429): it's not "too frequent",
      // it's "this tank is empty".
      const second = await publicTurn(request, 'second ');
      expect(second, '油尽后匿名 turn 必须被挡（403 gas_exhausted），否则 owner 的花销上限对 public 无效')
        .toBe(403);
    });
});
