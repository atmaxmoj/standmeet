// agent-tool-result-attribution.spec.ts -- F-S-1: when a turn dispatches N tool
// calls, there should be N results, each **individually attributable**.
//
// How this was hit: while driving corpus-search check 2 (star), the agent sent
// two `corpus_search` calls in one turn -- `recursive convergence` and
// `递归收敛` (its Chinese equivalent). Two `agent tool done` lines came back:
// one empty-handed (after F-S-2, an empty result also carries a note, so it's
// no longer 2 bytes),
// one at 7883 bytes. **No field in the log can answer which one belongs to
// which search** -- `start` carries args, `done` carries only name + byte
// count, and parallel dispatch means arrival order proves nothing. So the
// question "did the CJK query actually hit" cannot be answered today, and
// that question is the back half of that check.
//
// **Why the assertion targets the log, not the product surface.** This
// invariant is about whether there is a traceable link between a call and its
// result; the product UI only shows a summary (`SEARCHED 9 · READ 4`), and the
// API never returns per-call results either. The log is the only place this
// fact exists, so the guard has to read the log ([[read-the-key-not-the-name]]).
//
// **It was, for a while, impossible to write.** Reproducing it needs the same
// tool called twice in one turn, and the mock used to send only one tool_use
// per turn -- several items marked their backing test `gap` for exactly this
// reason. The mock can now dispatch multiple calls in one message, which is
// what makes this guard possible at all.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken, backendLogTail } from '@/fixtures/instance';
import { scriptMockParallelToolCalls } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'tool-attrib@example.com', password: 'correct-horse-battery-staple',
  handle: 'toolattrib', fullName: 'Tool Attribution Owner',
};
const CODE = 'ATTRIB-01';

test.describe('F-S-1 · a tool result can be traced back to the call that produced it', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('two searches in one turn → two results, each attributable to its own call',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      // Same name, different query -- exactly the shape that collapses attribution.
      const tag = await scriptMockParallelToolCalls(request, [
        { name: 'corpus_search', args: { query: 'attribution-probe-alpha' } },
        { name: 'corpus_search', args: { query: 'attribution-probe-beta' } },
      ]);
      await request.dispose();

      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
      const input = page.getByTestId('chat-input-field');
      await input.fill(`hello${tag}`);
      await input.press('Enter');
      // Wait for the turn to **actually finish**, not for a fixed delay: the
      // progress indicator appearing means tools started running, and it
      // disappearing means the turn wrapped up.
      // A fixed wait on a slow machine would read the log before both calls
      // return, catch it mid-flight, and wrongly conclude "only one result" --
      // a test-case defect that disguises itself as a product defect.
      const progress = page.getByTestId('chat-progress');
      await expect(progress).toBeVisible({ timeout: 15_000 });
      await expect(progress).toBeHidden({ timeout: 30_000 });

      const log = backendLogTail();
      const starts = toolLines(log, 'agent tool start', 'corpus_search');
      const dones = toolLines(log, 'agent tool done', 'corpus_search');

      // Positive control: the mock really dispatched two calls, and both
      // completed. Without this, the assertion below would also pass green
      // when nothing ran at all ([[assertion-that-cannot-fail]]).
      expect(starts.length, 'the turn dispatched two corpus_search calls').toBe(2);
      expect(dones.length, 'both calls produced a result').toBe(2);

      // The real invariant: each result carries something that points back to
      // its own call. Today the done line only has name + result_bytes, and
      // the two lines look identical -- so this Set has only 1 element, red.
      const fingerprints = new Set(dones.map(attributionKeyOf));
      expect(
        fingerprints.size,
        'each result carries something that identifies which call it came from',
      ).toBe(2);
    });
});

// toolLines -- lines of a given tool-event kind from the log. docker compose's
// output carries a service-name prefix, so match by substring.
function toolLines(log: string, msg: string, tool: string): string[] {
  return log.split('\n').filter((l) => l.includes(`"${msg}"`) && l.includes(`"${tool}"`));
}

// attributionKeyOf -- the part of a result line that says "which call this
// came from".
//
// Deliberately **excludes** result_bytes: two calls can easily return the same
// byte count, and distinguishing by byte count then would be pure luck.
// What's wanted is the call's own identity (call id or its args), so this
// strips everything except the timestamp and byte count.
function attributionKeyOf(line: string): string {
  return line
    .replace(/"time":"[^"]*",?/, '')
    .replace(/"result_bytes":\d+,?/, '')
    .trim();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'attrib-role', description: 'tool attribution spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, { code: CODE, label: 'attrib', role_id: role.id });
  await request.dispose();
}
