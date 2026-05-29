// admin-code-create-grants-skill.spec.ts —— owner creates an access
// code via the admin REST surface, granting calendar.book + setting
// max_bookings=1. The persisted code carries both attributes.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import {
  seedOwnerLoggedIn, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';

test.describe('admin · code create persists granted_skills + max_bookings', () => {
  let seed: BaseSeed;
  test.beforeAll(async ({ playwright }) => { seed = await prep(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('issue code with calendar.book + max_bookings=1 → both echoed back',
    async () => {
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'],
        max_bookings: 1,
      });
      expect(code.granted_skills).toEqual(['calendar.book']);
      expect(code.max_bookings).toBe(1);
      expect(code.code).toMatch(/^[A-Z0-9-]+$/);
    });

  test('default empty granted_skills + null max_bookings when omitted', async () => {
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {});
    expect(code.granted_skills).toEqual([]);
    expect(code.max_bookings).toBeNull();
  });
});

async function prep(playwright: Playwright): Promise<BaseSeed> {
  return seedOwnerLoggedIn(playwright);
}
