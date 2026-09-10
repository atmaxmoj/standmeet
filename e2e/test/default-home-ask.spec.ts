// default-home-ask.spec.ts —— the DefaultHome ask box actually WORKS: a codeless visitor typing a
// question is handed off to /gate carrying it. The audit found this widget was only screenshot-
// observed (default-home-look.spec asserts it renders), never exercised — a broken ask box would
// have passed. Codeless visitors can't chat inline (the corpus is gated), so the ask box is a
// click-through to /gate?q=<question>.

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'defaulthome-ask@example.com', password: 'correct-horse-battery-staple',
  handle: 'defaulthomeask', fullName: 'Default Home Ask Owner',
};
const QUESTION = 'what is your take on retrieval quality';

test.describe('DefaultHome · the ask box hands a codeless visitor to /gate with the question', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('typing a question and asking navigates to /gate carrying it', async ({ page }) => {
    test.setTimeout(60_000);
    await openReader(page, '/c/observe'); // no session → visitor fallback → DefaultHome
    await expect(page.getByTestId('default-home')).toBeVisible({ timeout: 20_000 });

    // Type a question into the DefaultHome ask box and ask.
    await page.getByTestId('agent-widget-input').fill(QUESTION);
    await page.getByTestId('agent-widget-ask').click();

    // A codeless ask is a click-through to /gate carrying the question (never a silent no-op).
    await page.waitForURL(/\/gate\?q=/, { timeout: 15_000 });
    expect(decodeURIComponent(page.url()), 'the typed question is carried to /gate')
      .toContain('retrieval quality');
  });
});
