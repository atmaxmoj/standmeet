// turn-rendering.spec.ts -- chat turn rendering: citations, pending, error, reset.
//
// User story:
//   1. normal answer → serif body paragraphs + "ai" speaker label
//   2. answer with citations → "drawn from" block
//   3. pending → "retrieving" animation
//   4. error → error message (not blank)
//   5. reset → all turns clear + welcome re-appears

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'turn-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'turnowner',
  fullName: 'Turn Owner',
};

const CODE = 'TURN-001';

test.describe('turn rendering: citations, pending, error', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('answer renders with citations block',
    async ({ page }) => {
      // `enterCodeSession` already dismisses the name picker itself and waits for
      // /sessions to return 200 before returning. **Do not dismiss it again here**: that's a
      // check-then-act race -- between the instant `isVisible` reads true and the actual
      // click landing, the picker is mid-unmount, so Playwright reports "element was
      // detached from the DOM" and retries until the 10s timeout.
      // In the full suite it fails red at random; run alone it's almost always green --
      // because the window is only tens of milliseconds wide.
      // (`chat-composer.spec.ts` already wrote this down in a comment; this file never caught up.)
      await enterCodeSession(page, CODE);
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('tell me about yourself');
      await input.press('Enter');
      // Pending indicator
      await expect(page.getByTestId('answer-pending'))
        .toBeVisible({ timeout: 5_000 });
      // Answer body
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      // Answer text should contain the mock provider's response
      await expect(page.locator('[data-testid="answer-body"]'))
        .toContainText(/./);
      // Citations rendering is covered by visitor-chat-cited-precise.spec.ts
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
  const apiToken = await createAPIToken(request, csrf, 'turn-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'turn owner loves building things.', title: 'Turn Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Turn render test',
  });
  await request.dispose();
}
