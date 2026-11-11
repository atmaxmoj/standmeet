// second-code-switches-session.spec.ts —— presenting a second access code must SWITCH the session
// to it (StandMeet spec 2026-11-10). The existing visitor-code-switch.spec only proves the picker
// APPEARS for code B; it never drives the picker to completion, so the real defect — the session
// stays on code A after presenting B — shipped uncaught. This drives the full switch and checks the
// active session is B's, not A's.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'secondcode@example.com', password: 'correct-horse-battery-staple',
  handle: 'secondcode', fullName: 'Second Code Owner',
};
const CODE_A = 'FIRST-AAA1';
const CODE_B = 'SECOND-BBB2';
const NAME = 'Recruiter Rhea';

test.describe('presenting a second code switches the active session', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('A live, then present B → the session, header and quota are B’s (not A’s)',
    async ({ page }) => {
      test.setTimeout(90_000);
      // Live session for code A.
      await enterCodeSession(page, CODE_A, NAME);
      await expect(page.getByTestId('chat-input-field'), 'A is a live chat').toBeEnabled({ timeout: 20_000 });
      await expect(page.getByTestId('session-strip'), 'header shows A').toContainText(CODE_A, { timeout: 10_000 });

      // Present a different code in the same window → must switch to B.
      await enterCodeSession(page, CODE_B, NAME);
      await expect(page.getByTestId('chat-input-field'), 'B is a live chat').toBeEnabled({ timeout: 20_000 });
      await expect(page.getByTestId('session-strip'), 'header now shows B').toContainText(CODE_B, { timeout: 10_000 });
      await expect(page.getByTestId('session-strip'), 'no A label remains').not.toContainText(CODE_A);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, { code: CODE_A, label: 'Link A', max_turns_per_session: 50, max_members: 10 });
  await createCode(request, csrf, { code: CODE_B, label: 'Link B', max_turns_per_session: 50, max_members: 10 });
  await request.dispose();
}
