// code-ghost-evidence-tooltip.spec.ts — the "ghost evidence" control on a code card carries a "?"
// help affordance explaining what it is. The label alone ("ghost evidence" / inherit·require·allow)
// tells an owner nothing about what a ghost, or its evidence, actually is (owner: "幽灵证据加个问号
// tooltip 吧，不然不清楚是什么"). The account panel already uses this exact pattern (the recovery
// row's ⓘ dot); this brings it to the codes panel.
//
// Real control, real affordance: seed a code, open the codes panel, and assert the help dot sits by
// the ghost-evidence control and carries an actual explanatory tooltip (a non-empty title that is
// more than an echo of the one-word label).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createCode } from '@/fixtures/codes';

const OWNER = {
  email: 'ghost-tooltip@example.com', password: 'correct-horse-battery-staple',
  handle: 'ghosttooltip', fullName: 'Ghost Tooltip Owner',
};
const CODE = { code: 'GHOSTHELP-1', label: 'ghost help' };

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('codes · ghost-evidence has a "?" help tooltip', () => {
  test.beforeAll(async ({ playwright }) => { await seedOwnerWithCode(playwright); });

  test('a "?" dot by the ghost-evidence control explains what it is', async ({ adminPage: page }) => {
    test.setTimeout(90_000);
    await page.getByTestId('admin-nav-codes').click();
    const card = page.getByTestId(`code-card-${CODE.code}`);
    await expect(card, 'the seeded code card renders').toBeVisible({ timeout: 30_000 });

    // The ghost-evidence control is here (proves we're looking at the right spot).
    await expect(card.getByTestId(`code-ghost-evidence-${CODE.code}`)).toBeVisible();

    // The help affordance sits with it and carries a real explanation — not just the label again.
    const help = card.getByTestId('code-ghost-evidence-help');
    await expect(help, 'a "?" help dot is shown by ghost evidence').toBeVisible();
    await expect(help, 'the dot reads as a question mark').toHaveText('?');
    const tip = (await help.getAttribute('title')) ?? '';
    expect(tip.length, 'the tooltip is an actual explanation, not an empty/echoed label')
      .toBeGreaterThan(20);
  });
});

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
