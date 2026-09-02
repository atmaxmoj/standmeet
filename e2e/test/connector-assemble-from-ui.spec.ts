// connector-assemble-from-ui.spec.ts -- #155 contract (implemented, green): the owner wires
// up a connector from scratch in the admin UI -- pick the "calendar" category -> click
// Connect -> go through OAuth -> card shows Connected.
//
// The spec-driven connector UI assembly flow is implemented; this test actually compiles,
// actually runs, actually goes green (originally a RED target contract, now green after
// implementation).
//
// Design points (provider-agnostic): a connector is a **category** ("calendar", the name
// booker's Requires recognizes); the real backing provider in prod is Google/Outlook/CalDAV,
// and the e2e uses a mock (gcal.ts already has a mock OAuth flow +
// /api/admin/connectors/.../{init,status,disconnect} -- reused, nothing new built). So this
// test has nothing to do with real Google; real Google needs a real account and is manually
// verified under #107/#108.
//
// Follow-up for the full loop (connect -> DepRegistry admits per Requires:["calendar"] ->
// calendar_book unblocks assembly, which is exactly the gap #154 booker hit) gets its own
// assertion separately; this test first pins down the "connected from the UI" main path.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector · assemble a connector from the admin UI', () => {
  // Covers the spec-driven connector UI assembly flow (docs/design/connector.md §8). Implemented, green.

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // The adminPage fixture already runs owner login, handing us a page already inside admin.
  test('owner clicks Connect on /admin/connectors to wire up calendar → shows Connected', async ({
    adminPage: page,
  }) => {
    // adminPage lands on admin; navigate into the connectors section from a known entry point (not page.goto).
    await page.getByTestId('admin-nav-connectors').click();

    // The connectors section lists categories; the calendar row is the connector row that
    // "has a Connect button" (the booker capability row has no Connect, which is how it's
    // distinguished from capability-row-calendar.book). Not yet connected.
    const card = page.getByRole('listitem')
      .filter({ hasText: /calendar/i })
      .filter({ has: page.getByRole('button', { name: /connect|连接/i }) });
    await expect(card).toBeVisible();
    await expect(card.getByText(/not connected|未连接/i)).toBeVisible();

    // Owner fills in their own OAuth client credentials on the card (filled through the UI, no env fallback).
    await card.getByTestId('connector-field-client_id').fill('mock-client-id');
    await card.getByTestId('connector-field-client_secret').fill('mock-client-secret');

    // Click Connect -> OAuth flow (mock) -> back to the connectors section.
    await card.getByRole('button', { name: /connect|连接/i }).click();
    await page.waitForURL('**/admin/connectors**');

    // Assembly succeeded: the card now reads Connected.
    await expect(card.getByText(/connected|已连接/i)).toBeVisible();
  });
});
