// sources-page-does-not-promise-a-scan — the fetch mechanism /admin/sources describes
// must be **the real one**.
//
// F-E-6: this page says *"Each source is scanned every 30 minutes."* — while every one
// of the four sources on this instance shows `never fetched`, and `/admin/system`'s
// background job table has **no such job** either. The backend only registers three
// periodics (resume-draft sweep / inference usage cleanup / sandbox workspace sweep) —
// not a single source scan among them. **This sentence describes a mechanism that
// doesn't exist.**
//
// This is worse than "the copy is inaccurate": after reading it, the owner thinks
// sitting and waiting is enough, so they wait forever — while the real entry point
// (having Claude run `jobs.fetch_new`) isn't mentioned on this page at all.
// `/admin/listings` gets it right, so the same product tells two different stories
// on two pages.
//
// Two assertions, both aimed at **what this page says**:
//   1. it must not promise an automatic scan (that's false);
//   2. it must name the real entry point (`jobs.fetch_new`), otherwise the owner has
//      nowhere to go.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'sources-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sourcesowner',
  fullName: 'Sources Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('the sources page describes the fetch that actually exists', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('no promise of an automatic scan; the real entry point is named (F-E-6)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      // Read the text first, then judge it — `.not.toContainText` also passes while
      // the element hasn't even appeared yet ([[negated-assertion-passes-while-absent]]).
      const intro = await adminPage.getByTestId('sources-intro').innerText();
      expect(intro, 'the page must not promise a scheduled scan that no periodic performs')
        .not.toMatch(/scanned every|every \d+ minutes|automatically fetch/i);
      expect(intro, 'the page must name the way listings actually arrive')
        .toContain('jobs.fetch_new');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  await request.dispose();
}
