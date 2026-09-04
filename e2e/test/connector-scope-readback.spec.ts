// connector-scope-readback.spec.ts —— F-C-33. **After connecting, can the owner still see what they granted?**
//
// `connector-connect-flow.spec.ts` has a case guarding the **write** half: the checked scope subset enters the dance unchanged.
// Nothing ever asked about the **read** half —— and that is exactly what drove wrong on prod: `calendar · connected`,
// with both scope checkboxes below it **empty**, still empty after a reload.
//
// That is not "showing a stale value". The checkboxes have neither `checked` nor `defaultChecked`, and the admin API
// has no "which scopes this connection granted" field at all —— this cell is **write-only, never read back**. The cost is more than ugly:
// when the owner wants to add a scope, there is no trustworthy starting point on screen, and no way to tell what range is being sent.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import {
  ensureDisconnected, expectConnected, fillOAuth2Creds,
  openConnectorCard, resetMockOAuthRecord, selectScope,
} from '@/fixtures/connector-card';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'scoperead@example.com',
  password: 'scope-readback-pass-1',
  handle: 'scopereadowner',
  fullName: 'Scope Readback Owner',
};

const OAUTH2_CONNECTOR_ID = 'google-calendar';
const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events';

// adminPage logs in with these credentials —— without setting them it logs in as the default alice, but this file claims
// the owner above, so the admin shell can't be entered at all (surfaces as `admin-nav-page` timing out).
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('F-C-33 · a connection shows the scopes it was granted', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000); // resetInstance takes ~48s under high load
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('the granted scopes are still visible after leaving and coming back',
    async ({ adminPage: page }) => {
      const clientID = 'scope-readback-client-id';
      await resetMockOAuthRecord(page);
      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      await ensureDisconnected(card);
      await fillOAuth2Creds(card, clientID, 'mock-client-secret');
      // Grant a **subset**: READ granted, WRITE not.
      await selectScope(card, SCOPE_READ, true);
      await selectScope(card, SCOPE_WRITE, false);
      await card.getByTestId('connector-connect-button').click();
      await page.waitForURL('**/admin/connectors**');
      await expectConnected(card);

      // Leave this page and come back —— this is what the owner sees returning the next day.
      const back = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      await expectConnected(back);
      await expect(back.getByTestId(`connector-scope-${SCOPE_READ}`),
        'the scope this connector was actually granted still reads as granted')
        .toBeChecked();
      await expect(back.getByTestId(`connector-scope-${SCOPE_WRITE}`),
        'and one that was never granted does not')
        .not.toBeChecked();
    });
});
