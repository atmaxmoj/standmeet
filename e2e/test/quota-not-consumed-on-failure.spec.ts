// quota-not-consumed-on-failure.spec.ts —— a failed turn does not consume quota.
//
// Owner requirement: it doesn't count as a consumed turn unless the AI replies
// successfully; retries never count, only one successful reply is +1. Since
// #28 the backend owns this rule: at the tail end of the /agent/turn stream,
// dialog is sunk into the conversation table (the count source for
// CountVisitorTurns) only when the AI actually produced content; a failed
// turn's answer is empty → nothing is persisted → nothing is consumed. The
// frontend's `used` is derived from local dialogs (the failed one isn't
// counted), so the display stays in sync.
//
// Verification: fire three turns in a row on the same session — success /
// injected failure / success — the gauge's used count should go 1 → 1 → 2 (the
// middle failure is free). The failure is injected via the mock gateway's
// next_error (all /v1/messages calls return 500), which triggers the backend's
// retry + force-final to both fail → an SSE error frame → the frontend's
// fallback copy, no consumption.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockReplyText, scriptMockError } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'quota-fail-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'quotafailowner',
  fullName: 'Quota Fail Owner',
};

const CODE = 'QUOTA-FAIL-001';

test.describe('failed turn does not consume a turn', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('success → used 1; injected failure → still 1; success → 2',
    async ({ page, request }) => {
      // enterCodeSession already skips the name picker and waits for /sessions 200 —
      // don't dismiss it a second time (could land inside the picker's unmount
      // window → click times out at 10s, a check-then-act race).
      await enterCodeSession(page, CODE);

      const used = page.getByTestId('session-strip-turns-used');
      const input = page.getByTestId('chat-input-field');
      const answers = page.getByTestId('answer-body');
      await expect(used).toHaveText('0');

      // 1) One successful turn → used = 1
      const firstTag = await scriptMockReplyText(request, 'Here is a real, grounded answer.');
      await input.fill(`first question${firstTag}`);
      await input.press('Enter');
      await expect(answers).toHaveCount(1, { timeout: 20_000 });
      await expect(used).toHaveText('1');

      // 2) One turn with an injected failure → used is still 1 (a failure doesn't
      //    consume). A failed turn still renders an answer-body (friendly error
      //    copy inside it), so waiting for the 2nd one to appear marks this turn's end.
      const failTag = await scriptMockError(request);
      await input.fill(`this turn fails upstream${failTag}`);
      await input.press('Enter');
      await expect(answers).toHaveCount(2, { timeout: 20_000 });
      await expect(used).toHaveText('1');

      // 3) Another successful turn → used = 2 (the failure in between was never counted)
      const thirdTag = await scriptMockReplyText(request, 'Another real answer after the failure.');
      await input.fill(`third question${thirdTag}`);
      await input.press('Enter');
      await expect(answers).toHaveCount(3, { timeout: 20_000 });
      await expect(used).toHaveText('2');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'quota-fail-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'quota-fail owner intro.', title: 'Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Quota fail test', max_turns_per_session: 5,
  });
  await request.dispose();
}
