// secret-input-reveal.spec.ts —— every password / token field has an eye that shows what was typed.
//
// Owner, 2026-09-30, looking at the Discord card's token field (five dots, no way to check the
// paste): "这种密码的你都应该排查一下，都需要那种小眼睛". Only the login form had one. A pasted token
// that is one character short looks exactly like a right one until the connect fails.
//
// Driven the way the owner does it: open each page, find each masked field, press its eye, and the
// field now shows its text; press again and it is masked again.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'secretreveal@example.com', password: 'correct-horse-battery-staple',
  handle: 'secretreveal', fullName: 'Secret Reveal Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('masked fields have an eye', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  for (const section of ['suppliers', 'providers', 'api-mcp', 'account']) {
    test(`every masked field on ${section} reveals and hides`, async ({ adminPage }) => {
      await gotoAdminSection(adminPage, section);
      await settled(adminPage, section);
      await expectEveryMaskedFieldReveals(adminPage);
    });
  }
});

// settled —— every masked field this page will show is on it. The suppliers page renders its
// calendar panel at once but each supplier card's fields only after its form arrives; walking the
// eyes by index before that pairs the n-th eye of one moment with the n-th field of another.
async function settled(page: Page, section: string): Promise<void> {
  if (section !== 'suppliers') return;
  await expect(page.getByTestId('supplier-row-telegram'), 'the catalog cards are in').toBeVisible({
    timeout: 15_000,
  });
  const connect = page.getByTestId('supplier-connect-button');
  await expect(connect.first()).toBeVisible();
  await expect(page.locator('[data-testid="supplier-connect-button"]:disabled'),
    'every card has its form').toHaveCount(0, { timeout: 15_000 });
}

async function expectEveryMaskedFieldReveals(page: Page): Promise<void> {
  const masked = page.locator('input[type="password"]');
  await expect(masked.first(), 'this page has a masked field').toBeVisible({ timeout: 15_000 });
  const n = await masked.count();
  // Several cards can share a field's testid (every token card has `supplier-field-token`), so walk
  // the eyes — each one sits next to the field it shows.
  const eyes = page.locator('[data-testid$="-reveal"]');
  await expect(eyes, 'one eye per masked field').toHaveCount(n);
  for (let i = 0; i < n; i++) {
    const eye = eyes.nth(i);
    const field = eye.locator('xpath=preceding-sibling::input[1]');
    await field.fill('typed-secret-123');
    await eye.click();
    await expect(field, `field ${i}: the eye shows the text`).toHaveAttribute('type', 'text');
    await expect(field).toHaveValue('typed-secret-123');
    await eye.click();
    await expect(field, `field ${i}: pressing again masks it`).toHaveAttribute('type', 'password');
  }
}
