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
import { gotoUnhydrated } from '@/fixtures/navigate';

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
      await gotoUnhydrated(page, '/'); // it reloads itself: no `load` wait
      // The dead token's code is rescued into pending (session-recovery.ts); DEAD-01 does not
      // open, so the name picker's check drops it and the visitor gets the public front page.
      // Asserted FIRST because it is the half that proves the mount probe actually ran:
      // `toBeHidden` on the strip below passes just as well when nothing ever rendered, so on its
      // own it cannot tell "validated away" from "not there yet". (A rescued code that still opens
      // re-asks for a name: visitor-dead-session-recovery.spec.ts.)
      await expect(page.getByTestId('default-home')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('visitor-name-overlay')).toHaveCount(0);
      // The "unlocked" chrome must be gone: the liveness probe 401'd the dead token and cleared
      // the stored session. (RED before the fix: the strip renders off stale localStorage and stays.)
      await expect(page.getByTestId('session-strip')).toBeHidden({ timeout: 5_000 });
    });
});

async function plantDeadSession(page: Page): Promise<void> {
  await page.addInitScript(([dead]) => {
    // Planted once per tab: the page reloads itself after dropping the dead code, and a browser
    // does not bring a cleared session back.
    if (sessionStorage.getItem('planted') === '1') return;
    sessionStorage.setItem('planted', '1');
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
