// code-members-floating.spec.ts — opening a code's "members" picker must NOT push the code page
// around. Today it expands inline (the list renders in the card's grid), so everything below it jumps
// down (owner, Image#52: "那个 picker 做成 floating，别挤占/影响 code 页布局"). A floating panel
// (overlay / absolutely-positioned, or a portal) shows the members without moving anything under it.
//
// Geometry, not text, and the RIGHT geometry (owner: "应该判别的是，下面的东西没有变化位置"): the
// complaint is not "the card grew" per se — it is "the stuff below the picker moved". So this pins a
// reference element BELOW the picker (the card footer's expiry line) and asserts its screen position
// does not change when members open, while still confirming the panel actually became visible (a dead
// toggle would also leave the position unchanged — both facts are required).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Locator, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createCode } from '@/fixtures/codes';

const OWNER = {
  email: 'members-float@example.com', password: 'correct-horse-battery-staple',
  handle: 'membersfloat', fullName: 'Members Float Owner',
};
const CODE = { code: 'FLOATMEM-1', label: 'float members' };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('codes · the members picker floats (does not grow the card)', () => {
  test.beforeAll(async ({ playwright }) => { await seedOwnerWithCode(playwright); });

  test('opening members shows the panel without moving anything below it', async ({ adminPage: page }) => {
    test.setTimeout(90_000);
    await page.getByTestId('admin-nav-codes').click();
    const card = page.getByTestId(`code-card-${CODE.code}`);
    await expect(card, 'the seeded code card renders').toBeVisible({ timeout: 30_000 });

    // The reference "下面的东西": the card footer's expiry line, which sits below the members picker.
    const below = card.getByTestId('code-expiry');
    await expect(below).toBeVisible();
    const yBefore = await boxTop(below);

    await card.getByTestId(`members-toggle-${CODE.code}`).click();

    // The members panel actually opened — otherwise "position unchanged" would pass on a dead toggle.
    await expect(
      card.getByTestId(`members-panel-${CODE.code}`),
      'the members panel is shown after opening',
    ).toBeVisible({ timeout: 10_000 });

    const yAfter = await boxTop(below);
    // Floating: the element below the picker must not move (the ↓/↑ arrow swap is zero-height).
    expect(Math.abs(yAfter - yBefore), 'nothing below the picker moves when members open (it floats)')
      .toBeLessThan(4);
  });
});

async function boxTop(loc: Locator): Promise<number> {
  const box = await loc.boundingBox();
  expect(box, 'the element has a measurable box').not.toBeNull();
  return (box as { y: number }).y;
}

async function seedOwnerWithCode(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createCode(request, csrf, CODE);
  await request.dispose();
}
