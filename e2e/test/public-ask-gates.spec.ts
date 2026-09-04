// public-ask-gates.spec.ts — a purely public visitor with no code and no BYOAI
// **cannot chat directly**. The product model has only three tiers: has a code /
// BYOAI (brings their own key) / gate (blocked outright). A public visitor asking in
// the homepage Ask box should **route to /gate** (fill in a code or BYOAI), not open
// a chat directly using the owner's key.
//
// Currently (the bug): homepage public mode → issuePublicSession() sends a session
// and opens chat directly → **RED**.
// After the fix: an ask in public mode routes to /gate → GREEN.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'gateowner@example.com', password: 'correct-horse-battery-staple',
  handle: 'gateowner', fullName: 'Gate Owner',
};

test.describe('no-code/no-BYOAI visitor cannot chat ungated', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('asking on the public index routes to /gate, no chat happens',
    async ({ page }) => {
      // The homepage is a custom page installed at claim + auto-promoted once built; wait for
      // it to be live before asking on it (else `/` shows the fallback, which has no ask box).
      await expect.poll(
        async () => (await page.request.get('/api/v1/homepage')).status(),
        { timeout: 60_000, message: 'the default homepage auto-goes-live' },
      ).toBe(200);
      await goto(page, '/');
      // The homepage's ask box is the SDK AgentWidget's input; codeless, it hands off to /gate.
      const input = page.locator('[data-testid="agent-widget-input"]');
      await expect(input).toBeVisible({ timeout: 20_000 });
      await input.fill('What are you working on?');
      await input.press('Enter');
      // Routes to gate (the code/BYOAI entry point), not into a chat.
      await expect(page).toHaveURL(/\/gate/, { timeout: 5_000 });
      await expect(page.getByTestId('code-panel')).toBeVisible();
      // No answer was produced (no chat happened by bypassing the gate).
      await expect(page.locator('[data-testid="answer-body"]')).toHaveCount(0);
    });
});
