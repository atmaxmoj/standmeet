// draft-discard.spec.ts —— the "discard" button on a draft card throws the draft away: it opens a
// confirm modal, and confirming deletes the row (DELETE /api/admin/drafts/{id}) so it leaves the list.
//
// The bug (owner-reported): the discard button had NO onClick and there was no DELETE route — clicking
// it did nothing, silently ([[button-that-cannot-be-wired]]). This drives the real button → modal →
// confirm and asserts the card is gone, so a regression to an inert button (or a missing route) is RED.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-discard@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftdiscard', fullName: 'Draft Discard Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('discarding a draft removes it from the list (Q0)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('the discard button opens a confirm modal; confirming deletes the draft',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api: APIRequestContext = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const created = await api.post(`${BACKEND}/api/admin/drafts`, {
        headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
      });
      const id = (await created.json() as { id: string }).id;

      await goto(page, '/admin/drafts');
      const card = page.getByTestId('draft-card');
      await expect(card).toHaveCount(1);

      // Clicking discard opens the confirm modal (it must NOT delete straight away).
      await page.getByTestId(`draft-discard-${id}`).click();
      await expect(page.getByTestId('draft-discard-modal')).toBeVisible();
      await expect(card, 'still there until confirmed').toHaveCount(1);

      // Cancelling leaves it be.
      await page.getByTestId('draft-discard-cancel').click();
      await expect(page.getByTestId('draft-discard-modal')).toHaveCount(0);
      await expect(card).toHaveCount(1);

      // Confirming deletes it → the row leaves the list.
      await page.getByTestId(`draft-discard-${id}`).click();
      await page.getByTestId('draft-discard-confirm').click();
      await expect(card, 'the discarded draft is gone from the list').toHaveCount(0);

      // And it's really gone server-side (idempotent DELETE already applied): the detail 404s.
      const detail = await api.get(`${BACKEND}/api/admin/drafts/${id}`, { headers: { 'X-Csrftoken': csrf } });
      expect(detail.status(), 'the draft no longer exists on the backend').toBe(404);
      await api.dispose();
    });
});
