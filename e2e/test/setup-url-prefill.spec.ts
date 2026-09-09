// setup-url-prefill.spec.ts —— #4: on the first-run claim page, the PUBLIC URL field is prefilled
// with the domain the claimer is already sitting on (window.location.origin, path stripped), so a
// self-hoster on wingmeishu.com/setup?t=… gets "https://wingmeishu.com" instead of the placeholder.
//
// Positive + falsifiable: without the prefill the field is empty (toHaveValue('')), so this asserts
// it equals the actual origin.

import { test, expect } from '@/fixtures/test';

import { resetInstance } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

test.describe('first-run setup · PUBLIC URL prefilled from the browser origin', () => {
  test('the public-url field defaults to the current origin (not the placeholder)', async ({ page }) => {
    resetInstance();
    // An unclaimed instance redirects "/" to /setup?t=<token> (the first-run entry point).
    await goto(page, '/');
    await page.waitForURL(/\/setup\?t=/, { timeout: 10_000 });

    const origin = await page.evaluate(() => window.location.origin);
    await expect(page.getByTestId('public-url'), 'public URL prefilled with the current origin')
      .toHaveValue(origin);
  });
});
