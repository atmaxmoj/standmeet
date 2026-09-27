// codes-paging.spec.ts —— the codes list and its pickers page on the server (docs/design/paging.md).
//
// Before: GET /codes returned every code, and each picker (embed, preview, résumé) filtered that
// full array in the browser. With one page at a time, three things must hold:
//   1. the list shows one page, "load more" brings the rest, and the chip counts are the
//      server's (they count codes that are not loaded);
//   2. a search reaches a code that is not on the loaded page;
//   3. the embed list shows each embed's code string, and the embed picker leaves out codes an
//      embed already exposes — both used to be answered from the full codes array.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode, embedCode } from '@/fixtures/codes';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'codespaging@example.com', password: 'correct-horse-battery-staple',
  handle: 'codespaging', fullName: 'Codes Paging Owner',
};
const TOTAL = 55; // one page is 50
const name = (i: number) => `PAGE-${String(i).padStart(3, '0')}`;

async function rowCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="code-row-"]').count();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · codes page on the server', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    let first = '';
    for (let i = 1; i <= TOTAL; i++) {
      const c = await createCode(request, csrf, { code: name(i), label: `paging ${i}` });
      first = first || c.id;
    }
    // The oldest code gets an embed: it is on page 2 of the codes list.
    await embedCode(request, csrf, first, 'partner site');
    await request.dispose();
  });

  test('one page, then load more; the counts are the server\'s', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'codes');
    await expect(page.getByTestId(`code-row-${name(TOTAL)}`), 'newest first').toBeVisible();
    await expect.poll(() => rowCount(page)).toBe(50);
    await expect(page.getByTestId('codes-filter-active'), 'counts codes not loaded').toContainText(String(TOTAL));
    await page.getByTestId('codes-load-more').click();
    await expect(page.getByTestId(`code-row-${name(1)}`)).toBeVisible();
    await expect.poll(() => rowCount(page)).toBe(TOTAL);
    await expect(page.getByTestId('codes-load-more'), 'the last page has no load more').toHaveCount(0);
  });

  test('search reaches a code that is not on the loaded page', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'codes');
    await page.getByTestId('codes-search').fill(name(2));
    await expect(page.getByTestId(`code-row-${name(2)}`)).toBeVisible();
    await expect.poll(() => rowCount(page)).toBe(1);
  });

  test('a code\'s members page too: 50, then load more', async ({ adminPage: page }) => {
    const code = name(TOTAL);
    execSQL(`INSERT INTO code_members (code_id, display_name, last_seen_at)
      SELECT ac.id, 'member-' || g, now() - g * interval '1 minute'
      FROM access_codes ac, generate_series(1, 55) g WHERE ac.code = '${code}'`);
    await gotoAdminSection(page, 'codes');
    await page.getByTestId(`members-toggle-${code}`).click();
    const list = page.getByTestId(`members-list-${code}`);
    await expect(list).toContainText('member-1');
    await expect(list.locator('li')).toHaveCount(50);
    await page.getByTestId(`members-load-more-${code}`).click();
    await expect(list.locator('li')).toHaveCount(55);
    await expect(list).toContainText('member-55');
  });

  test('embeds show their code string; the picker leaves out embedded codes', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'embeds');
    await expect(page.getByTestId('embed-list'), 'the row names its code').toContainText(name(1));

    await page.getByRole('button', { name: /new embed/i }).click();
    const picker = page.getByTestId('embed-code');
    await page.getByTestId('embed-code-search').fill('PAGE-00');
    await expect(picker.locator('option', { hasText: name(2) }), 'a free code on page 2 is offered').toHaveCount(1);
    await expect(picker.locator('option', { hasText: name(1) }), 'the embedded code is not').toHaveCount(0);
  });
});
