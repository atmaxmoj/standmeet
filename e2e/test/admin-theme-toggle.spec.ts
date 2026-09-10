// admin-theme-toggle.spec.ts — the owner can switch the ADMIN between day and night. The public page
// has always had a toggle (TopBar → useTheme, which flips `.dark` on <html>); the admin had none, so
// an owner on a dark OS still got a bright-cream backend and no way to change it (owner: "我 admin 这
// 边怎么没办法调白天黑夜的").
//
// Black box, real control, real effect: click the toggle → <html> flips the `.dark` class AND the
// rendered background colour actually changes (a class that no CSS reads would flip the attribute yet
// leave the page identical — so this reads computed pixels, not the class alone) → and the choice
// survives a reload (the same localStorage lock the public toggle writes).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';

const OWNER = {
  email: 'admin-theme@example.com', password: 'correct-horse-battery-staple',
  handle: 'adminthemeowner', fullName: 'Admin Theme Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin day/night toggle', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('toggling flips the theme, changes the rendered background, and persists across reload',
    async ({ adminPage: page }) => {
      test.setTimeout(90_000);
      const toggle = page.getByTestId('admin-theme-toggle');
      await expect(toggle, 'the admin has a day/night toggle').toBeVisible({ timeout: 30_000 });

      const before = await themeState(page);

      await toggle.click();
      // Poll the class — useTheme's effect runs after the click handler commits state.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')), {
          message: 'clicking the toggle flips the dark class on <html>', timeout: 10_000,
        })
        .toBe(!before.dark);

      const after = await themeState(page);
      // The class is not enough — the page must actually look different. Some admin surface's
      // background must change colour, or the toggle is a no-op the owner cannot see.
      expect(after.bg, 'the rendered background colour changes with the theme').not.toBe(before.bg);

      // The choice is durable: reload lands in the toggled theme, not back on the default.
      await page.reload();
      await expect(page.getByTestId('admin-theme-toggle')).toBeVisible({ timeout: 30_000 });
      const reloaded = await themeState(page);
      expect(reloaded.dark, 'the theme choice survives a reload').toBe(after.dark);
      expect(reloaded.bg, 'the reloaded background matches the chosen theme').toBe(after.bg);
    });
});

// themeState — the two facts a real toggle must move together: the `.dark` marker on <html> and the
// colour actually painted behind the admin.
async function themeState(page: Page): Promise<{ dark: boolean; bg: string }> {
  return page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    bg: getComputedStyle(document.body).backgroundColor,
  }));
}
