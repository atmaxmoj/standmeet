// visitor-rate-limited-provider-degrades.spec.ts —— agent-loop-robustness checks 4 + 5,
// end to end.
//
// These two checks were always logged as "missing a mock that can inject a rate-limit
// response". That mock isn't some external device — the mock already injects a 500
// (`next_error`); 429 is just another status code plus a header, so `next_rate_limit
// {key, retry_after_seconds}` was added. The difference between 500 and 429 is exactly what
// this test covers: 500 means "broken", 429 means "**don't come back this fast**", and it
// carries an interval the provider explicitly states — retrying early only makes the
// rate-limiting worse.
//
// Two assertions:
//   check 5 ⭐ — the whole turn takes ≥ the interval the provider required (the hint was
//   really honored, not just honored inside a Go unit test);
//   check 4 — what the visitor gets is a plain sentence, not a 429 / stack trace / error
//   object.
//
// What's asserted is **elapsed time + the words on screen**, not logs: the owner can't see
// the logs, and the visitor certainly can't.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockRateLimit } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'RATELIMIT-001';
// RETRY_AFTER_S — the interval the provider requires. Chosen as 2s: long enough to
// distinguish "wasn't honored" from "was honored", without making the test case just sit
// there waiting.
const RETRY_AFTER_S = 2;
// LEAK_MARKERS — if any of these show up in front of the visitor, it means internals leaked.
const LEAK_MARKERS = /429|rate.?limit|NodeRunError|goroutine|panic|eino|http\.Client/i;

test.describe('a rate-limited provider degrades to a sentence, after waiting', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'ratelimit-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      body: 'lucerna is a local-first knowledge tool.',
      title: 'Lucerna', path: 'projects/lucerna',
    });
    await createCode(request, csrf, {
      code: CODE, label: 'rate limit', purpose: 'agent-loop-robustness 4+5',
    });
    await request.dispose();
  });

  test('honours the provider Retry-After, then says something a visitor can act on',
    async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);

      const tag = await scriptMockRateLimit(page.request, RETRY_AFTER_S);

      const input = page.locator('[data-testid="chat-input-field"]');
      const started = Date.now();
      await input.fill(`tell me about lucerna${tag}`);
      await input.press('Enter');

      // Something must appear in front of the visitor — it must not get stuck on pending.
      const body = page.locator('[data-testid="answer-body"]');
      await expect(body).toBeVisible({ timeout: 90_000 });
      const elapsed = Date.now() - started;
      const shown = await body.innerText();

      // check 5 ⭐: the provider said to wait N seconds, so at least N seconds must have
      // elapsed.
      expect(elapsed, 'must not retry before the provider said it could')
        .toBeGreaterThanOrEqual(RETRY_AFTER_S * 1000);
      // Non-empty guard: first prove there's actually text on screen, otherwise an empty
      // string would also satisfy "doesn't contain a leak marker".
      expect(shown.trim().length, 'the visitor must be told something').toBeGreaterThan(0);
      // check 4: that sentence is plain language, not internals.
      expect(shown, `visitor saw raw internals: ${shown}`).not.toMatch(LEAK_MARKERS);

      await ctx.close();
    });
});
