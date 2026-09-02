// coded-ask-continues.spec.ts — the full "has-code redirect" chain for the homepage Ask: a
// sessionless visitor asks a question on the homepage → redirected to /gate (the question
// carried via ?q=) → enters a code into the session → back in chat, that **carried question
// gets answered** (it is not dropped).
//
// Currently (bug): the homepage ask sends an inline reply on the public session, and the
// question never flows through the gate → **red**.
// Once fixed: ask → /gate?q=, gate issues the session and redirects to /?q=, ChatRoom
// consumes ?q= and answers it → green.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'askflow@example.com', password: 'correct-horse-battery-staple',
  handle: 'askflow', fullName: 'Ask Flow Owner',
};
const CODE = 'ASKFLOW-1';
const QUESTION = 'What are you working on?';

test.describe('homepage ask carries through gate into chat and gets answered', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'full', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'flow', assumed_role_id: role.id });
    const token = await createAPIToken(request, csrf, 'askflow-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      title: 'Current Work', body: 'I am building a notification pipeline.',
      path: 'current-work',
    });
    await request.dispose();
  });

  test('ask on homepage (no code) → gate → enter code → chat answers the carried question',
    async ({ page }) => {
      await goto(page, '/');
      // The homepage's ask field is `home-ask-field` (5e439b51 gave it a name distinct
      // from ChatRoom's input field).
      const input = page.locator('[data-testid="home-ask-field"]');
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.fill(QUESTION);
      await input.press('Enter');
      // Lands on gate, the question carried via ?q=.
      await expect(page).toHaveURL(/\/gate\?.*q=/, { timeout: 5_000 });
      // Enter the code to join the session.
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Sam');
      await page.getByTestId('gate-code-submit').click();
      // Back in chat: the session is live + the carried question gets answered (not lost).
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(QUESTION)).toBeVisible();
    });
});
