// conversations-paging.spec.ts —— the conversations list pages on the server
// (docs/design/paging.md).
//
// Before: GET /conversations returned the newest 50 (MCP up to 200) and nothing older could be
// reached; the header counted the loaded rows; the ?code= filter ran over those 50 only, so a
// code whose conversations were all older showed "no conversations".
//
// Seeding: 55 conversations inserted directly — each is a row, and driving 55 real visitor chats
// would test the chat, not the list. The oldest two are on a code, so they sit on page 2.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { execSQL, findSetupToken, resetInstance } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'convpaging@example.com', password: 'correct-horse-battery-staple',
  handle: 'convpaging', fullName: 'Conversations Paging Owner',
};
const TOTAL = 55;
const CODE = 'OLD-TALKS';

async function rows(page: Page): Promise<number> {
  return page.getByTestId('conv-table').locator('tbody tr').count();
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · conversations page on the server', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const code = await createCode(request, csrf, { code: CODE, label: 'old talks' });
    await request.dispose();
    // visitor-1 is the most recent; visitor-54 and visitor-55 are the oldest and on the code.
    execSQL(`INSERT INTO conversations (owner_id, mode, code_id, visitor_name, started_at, last_at)
      SELECT o.id, CASE WHEN g > 53 THEN 'code' ELSE 'byoai' END,
             CASE WHEN g > 53 THEN '${code.id}'::uuid END,
             'visitor-' || g, now() - g * interval '1 hour', now() - g * interval '1 hour'
      FROM owners o, generate_series(1, ${TOTAL}) g`);
  });

  test('one page, then load more; the header counts every conversation', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'conversations');
    await expect(page.getByTestId('conv-table')).toContainText('visitor-1');
    await expect.poll(() => rows(page)).toBe(50);
    await expect(page.getByText(`${TOTAL} sessions`), 'the server total, not the loaded rows').toBeVisible();
    await page.getByTestId('conversations-load-more').click();
    await expect(page.getByTestId('conv-table')).toContainText('visitor-55');
    await expect.poll(() => rows(page)).toBe(TOTAL);
  });

  test('?code= finds that code\'s conversations even when they are older than page 1', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'codes');
    await page.getByTestId(`code-card-${CODE}`).getByRole('link', { name: /view conversations/i }).click();
    await page.waitForURL(`**/admin/conversations?code=${CODE}`);
    await expect(page.getByTestId('conv-table')).toContainText('visitor-55');
    await expect.poll(() => rows(page)).toBe(2);
  });
});
