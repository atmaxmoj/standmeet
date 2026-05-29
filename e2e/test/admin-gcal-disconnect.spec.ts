// admin-gcal-disconnect.spec.ts —— from connected state, owner clicks
// Disconnect. Status flips to "credentials saved, not authorized" — i.e.
// client_id/secret are PRESERVED so the next Authorize is one click.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { disconnectGCal, getGCalStatus } from '@/fixtures/gcal';
import {
  seedOwnerGCalConnected, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';

test.describe('admin · GCal disconnect preserves credentials', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('connected → disconnect → has_credentials still true, connected false',
    async () => {
      const before = await getGCalStatus(seed.request);
      expect(before.connected).toBe(true);
      await disconnectGCal(seed.request, seed.csrf);
      const after = await getGCalStatus(seed.request);
      expect(after.has_credentials).toBe(true);   // credentials preserved
      expect(after.connected).toBe(false);
    });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerGCalConnected(playwright);
}
