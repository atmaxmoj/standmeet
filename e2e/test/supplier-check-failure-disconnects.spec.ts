// supplier-check-failure-disconnects.spec.ts —— a connected supplier whose connection check now
// fails is not connected any more, and stays so after a reload.
//
// Found on sijie, 2026-10-01: the Discord card held a token Discord refused. Pressing Connect ran
// the check, the card said "not connected" with the reason — and a reload said "connected" again,
// because the failed check never touched the stored state. The im-bridge kept being handed the
// refused token. Same for any supplier with a connection check: a CalDAV server that stops
// accepting the stored password.
//
// Driven the way the owner does it: the card's Connect button, then a reload. The CalDAV stand-in
// plays the server that accepted the credentials once and refuses them now.

import { test, expect } from '@/fixtures/test';

import { login } from '@/fixtures/admin';
import { connectCalDAVBlock, failCalDAVVerify, resetCalDAV } from '@/fixtures/caldav-mock';
import { gotoAdminSection, reloadAdminSection } from '@/fixtures/navigate';
import { claimFreshOwner } from '@/fixtures/seed';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const CALDAV_MOCK = process.env['CALDAV_MOCK_URL'] ?? 'http://localhost:9000';
const CALDAV_API = 'http://external-mock:9000'; // how the backend container reaches the mock
const COLL = 'caldav'; // the shipped CalDAV block's id = its mock collection

const OWNER = {
  email: 'checkfail@example.com', password: 'correct-horse-battery-staple',
  handle: 'checkfail', fullName: 'Check Fail Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a failed connection check disconnects', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    const request = await playwright.request.newContext();
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    await resetCalDAV(request, CALDAV_MOCK, COLL);
    await connectCalDAVBlock(request, { backend: BACKEND, mockApi: CALDAV_API, csrf, coll: COLL });
    await failCalDAVVerify(request, CALDAV_MOCK, COLL, 401);
    await request.dispose();
  });

  test('Connect on a card whose server now refuses → not connected, still after a reload',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'suppliers');
      const card = adminPage.getByTestId(`supplier-row-${COLL}`);
      await expect(card.getByTestId('supplier-status'), 'connected to start with')
        .toHaveText(/^\s*connected\s*$/i, { timeout: 15_000 });

      await card.getByTestId('supplier-connect-button').click();
      // 30 s: the check dials the CalDAV block, and a cold dial is budgeted 20 s.
      await expect(card.getByTestId('supplier-error'), 'the card says the check failed').toBeVisible({
        timeout: 30_000,
      });

      // Read the stored state, not the card: a card that has not loaded its status yet shows
      // "not connected" by default, which would make this assertion pass before it looked.
      const res = await adminPage.request.get(`${BACKEND}/api/admin/suppliers/${COLL}/status`);
      expect(res.status()).toBe(200);
      const stored = await res.json() as { connected?: boolean };
      expect(stored.connected, 'the stored state agrees with the failed check').toBe(false);

      await reloadAdminSection(adminPage, 'suppliers');
      await expect(adminPage.getByTestId(`supplier-row-${COLL}`).getByTestId('supplier-connect-button'),
        'the card has loaded').toBeEnabled({ timeout: 15_000 });
      await expect(adminPage.getByTestId(`supplier-row-${COLL}`).getByTestId('supplier-status'))
        .toHaveText(/not connected/i);
    });
});
