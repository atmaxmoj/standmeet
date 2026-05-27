// output-landing-extended.spec.ts —— output landing extended: 404, AskAboutThis.
//
// 用户故事：
//   1. 不存在的 output slug → 404
//   2. AskAboutThis (kind=output) → /?q=...

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'out-ext@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'outext',
  fullName: 'Output Ext Owner',
};

test.describe('output landing extended cases', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('nonexistent output slug → locked view',
    async ({ page }) => {
      await goto(page, '/output/nonexistent-output-slug-xyz');
      await expect(page.getByText('This output requires an access code'))
        .toBeVisible({ timeout: 5_000 });
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
