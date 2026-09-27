// requests-paging.spec.ts —— the access-requests list pages on the server (docs/design/paging.md).
//
// Before: GET /access-requests was a flat LIMIT 100; the 101st request could not be reached, the
// header and the sidebar badge counted the fetched rows, and the status chips filtered those rows
// in the browser.
//
// Seeding: rows inserted directly — the gate's own submit is rate-limited and captcha-guarded,
// and 60 visitor submissions would test that, not the list.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'reqpaging@example.com', password: 'correct-horse-battery-staple',
  handle: 'reqpaging', fullName: 'Requests Paging Owner',
};
const OPEN = 55; // one page is 50
const CLOSED = 5;

async function rows(page: Page): Promise<number> {
  return page.locator('[data-testid^="request-row-"]').count();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · access requests page on the server', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
    // asker-1 is the newest open request; the closed ones are newer still.
    execSQL(`INSERT INTO access_requests (owner_id, name, email, message, status, created_at)
      SELECT o.id, 'asker-' || g, 'asker' || g || '@example.com', 'let me in', 'open',
             now() - g * interval '1 hour'
      FROM owners o, generate_series(1, ${OPEN}) g`);
    execSQL(`INSERT INTO access_requests (owner_id, name, email, message, status, created_at)
      SELECT o.id, 'closed-' || g, 'closed' || g || '@example.com', 'old', 'closed', now()
      FROM owners o, generate_series(1, ${CLOSED}) g`);
  });

  test('one page of open requests, then load more; header and badge count them all', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'requests');
    await expect(page.getByTestId('requests-list')).toContainText('asker-1');
    await expect.poll(() => rows(page)).toBe(50);
    await expect(page.getByText(`${OPEN} new`), 'the server total').toBeVisible();
    await expect(page.getByTestId('badge-requests'), 'the badge counts every open one').toHaveText(String(OPEN));
    await page.getByTestId('requests-load-more').click();
    await expect(page.getByTestId('requests-list')).toContainText(`asker-${OPEN}`);
    await expect.poll(() => rows(page)).toBe(OPEN);
  });

  test('a status chip asks the server', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'requests');
    await page.getByTestId('requests-filters').getByRole('button', { name: 'closed' }).click();
    await expect(page.getByTestId('requests-list')).toContainText('closed-1');
    await expect.poll(() => rows(page)).toBe(CLOSED);
    await expect(page.getByText(`${CLOSED} total`)).toBeVisible();
  });
});
