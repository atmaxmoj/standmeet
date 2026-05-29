// admin-gcal-oauth-connect.spec.ts —— owner pastes their GCP client_id +
// client_secret, hits Authorize, mock OAuth dance completes, status flips
// to "Connected" with calendar id + scopes.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import {
  MOCK_GCAL_CREDS, getGCalStatus, initGCalOAuth, saveGCalCredentials,
} from '@/fixtures/gcal';
import {
  seedOwnerLoggedIn, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';

test.describe('admin · GCal OAuth · paste credentials → Authorize → Connected', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('initial status: no credentials, not connected', async () => {
    const status = await getGCalStatus(seed.request);
    expect(status.has_credentials).toBe(false);
    expect(status.connected).toBe(false);
  });

  test('after pasting credentials: has_credentials true, not yet connected', async () => {
    await saveGCalCredentials(seed.request, seed.csrf, MOCK_GCAL_CREDS);
    const status = await getGCalStatus(seed.request);
    expect(status.has_credentials).toBe(true);
    expect(status.connected).toBe(false);
  });

  test('init → mock OAuth dance → status flips to connected', async () => {
    const { auth_url } = await initGCalOAuth(seed.request, seed.csrf);
    expect(auth_url).toContain('mock-gcal-client-id');
    expect(auth_url).toContain('access_type=offline');
    expect(auth_url).toContain('prompt=consent');
    // Following the auth URL chain runs the mock + callback.
    const res = await seed.request.get(auth_url);
    expect(res.status()).toBe(200);
    const status = await getGCalStatus(seed.request);
    expect(status.connected).toBe(true);
    expect(status.calendar_id).toBe('primary');
    expect(status.scopes).toContain('https://www.googleapis.com/auth/calendar');
  });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerLoggedIn(playwright);
}
