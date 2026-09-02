// reader-expired-session.spec.ts —— F-L-11: an expired/dead visitor session must NOT keep presenting
// as "unlocked". Visitor sessions expire in Redis (sliding TTL) while the browser keeps the token in
// localStorage indefinitely; the reader/chat surface used to render full "unlocked" chrome from
// localStorage and fetch scoped data anonymously (→ empty body under a boastful header — owner-flagged
// "this won't do"). On mount the SessionStrip now probes GET /api/v1/session; a 401 (token no longer in
// Redis) clears the stored session so the strip drops to the honest anonymous state.
//
// This drives a REAL chat-capable surface (the public homepage, which mounts SessionStrip): a DEAD
// token is planted in localStorage, and we assert the session-strip disappears after the mount-time
// liveness probe. RED before the fix: with no probe the strip stays visible forever off stale
// localStorage.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'expired-reader@example.com', password: 'correct-horse-battery-staple',
  handle: 'expiredreader', fullName: 'Expired Reader Owner',
};
const DEAD_TOKEN = 'dead-token-not-in-redis-xxxxxxxx';

test.describe('F-L-11 · expired visitor session drops the fake "unlocked" chrome', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('a dead token in localStorage → strip validated away, not shown as unlocked',
    async ({ page }) => {
      await plantDeadSession(page);
      await goto(page, '/');
      // The public page still renders for anyone…
      await expect(page.locator('body')).toBeVisible();
      // …but the "unlocked" chrome must be gone: the liveness probe 401'd the dead token and cleared
      // the stored session. (RED before the fix: the strip renders off stale localStorage and stays.)
      await expect(page.getByTestId('session-strip')).toBeHidden({ timeout: 5_000 });
    });
});

async function plantDeadSession(page: Page): Promise<void> {
  await page.addInitScript(([dead]) => {
    // credential store (session_token) — must satisfy the StoredVisitorSession zod schema.
    localStorage.setItem('standmeet:visitor-session', JSON.stringify({
      session_token: dead, conversation_id: '', byoai: false,
    }));
    // display store (the "unlocked" chrome) — code!=null so the strip would render pre-validation.
    localStorage.setItem('standmeet-session', JSON.stringify({
      code: 'DEAD-01', visitor: null, byoai: false, byoaiProvider: '', label: 'invited',
      used: 0, max: 10, startedAt: 1_700_000_000_000, maxMembers: 0, memberCount: 0,
      email: '', ownerCanDeliver: false,
    }));
  }, [DEAD_TOKEN]);
}
