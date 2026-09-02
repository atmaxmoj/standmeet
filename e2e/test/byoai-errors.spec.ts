// byoai-errors.spec.ts —— BYOAI error flows: empty key, bad format, private topic.
//
// User story:
//   1. BYOAI empty key submit → button disabled
//   2. BYOAI key wrong format → client-side hint
//   3. BYOAI visitor asks a private topic → "need a code" response

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'byoai-err@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'byoaierr',
  fullName: 'Byoai Error',
};

test.describe('BYOAI error flows', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('empty API key → submit button disabled',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      // key is empty
      const submitBtn = page.getByTestId('byoai-submit');
      await expect(submitBtn).toBeDisabled();
    });

  // The previous version of this case was named "invalid key format → client-side
  // error shown", and it raced two `.catch(() => null)` calls then **asserted
  // nothing** — it went green no matter what happened
  // ([[assertion-that-cannot-fail]]). The name also implied the product does
  // client-side format validation; it doesn't: `presets.ts:27` comments keyPrefix
  // as a "sanity check", but nothing in the whole repo actually checks it — a
  // declared slot nobody wired up (F-O-4).
  //
  // Two criteria, both required: when the shape looks wrong, **say so** (the
  // visitor should see it right in the field, not three steps later after the
  // first inference round fails); and at the same time it must **never block** —
  // a self-hosted endpoint's key can look like anything, and turning the hint
  // into a hard gate would block legitimate configs, which is worse than today.
  test('key that does not look like the provider’s → a hint, and still submittable',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('not-a-valid-key');

      await expect(
        page.getByTestId('byoai-key-hint'),
        'the panel knows what an Anthropic key looks like — say it here, not after the first turn',
      ).toContainText('sk-ant-', { timeout: 5_000 });
      await expect(
        page.getByTestId('byoai-submit'),
        'a hint is not a gate: a self-hosted endpoint may issue any shape of key',
      ).toBeEnabled();
    });

  test('key that matches the provider’s shape → no hint at all',
    async ({ page }) => {
      await page.getByRole('link', { name: 'request access ↗' }).click();
      await page.waitForURL('**/gate', { timeout: 10_000 });
      await page.getByTestId('byoai-provider').selectOption('anthropic');
      await page.getByTestId('byoai-model').fill('claude-haiku-4-5-20251001');
      await page.getByTestId('byoai-key').fill('sk-ant-looks-right');
      // Positive control: otherwise "the hint is always shown" would also pass the case above.
      await expect(page.getByTestId('byoai-key-hint')).toHaveCount(0);
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
  const apiToken = await createAPIToken(request, csrf, 'byoai-err-seed');
  const sid = await initMCP(request, apiToken);
  await seedWiki(request, apiToken, sid, {
    body: 'public byoai content.', title: 'Public Intro', path: 'public/intro',
  });
  await request.dispose();
}
