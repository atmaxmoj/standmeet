// monitor-off-switch.spec.ts —— the owner's traffic-collection master switch (monitor.md §8),
// end to end through the REAL panel control.
//
// The owner flips the toggle in settings → monitor; from that click on, a visitor read records
// nothing, and flipping it back resumes recording. This is [[owner-facing-control-needs-ui-e2e]]:
// the assertion clicks the actual Toggle, not the API — a capability-only test would pass while
// the panel had no switch at all.
//
// Two rules this file keeps, both defects this repo has shipped before:
//  1. A 200 is not a receipt. Recording is asserted on the ROW read back, never on the visit's
//     own response (a public read answers 200 whether or not it was recorded).
//  2. The visitor is a fresh context (visitAsStranger), never the owner's — the owner is excluded
//     by design, so reusing the owner session would prove nothing about the switch.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { readEvents, visitAsStranger } from '@/fixtures/monitor';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'monitor-offswitch@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'monitoroffswitch',
  fullName: 'Monitor Offswitch',
};

const ENTRY = { title: 'The Collection Switch', path: 'the-collection-switch' };

let wikiID = '';

// readerHits —— how many reader views the panel holds for THIS entry. Filtered by the entry id so
// the count is about this test's reads, not the harness's own index traffic.
async function readerHits(request: APIRequestContext): Promise<number> {
  const rows = await readEvents(request, OWNER, { surface: 'reader', entity_id: wikiID });
  return rows.length;
}

// setCollection —— flip the master switch to `on` through the real toggle, waiting for the PUT to
// land so the very next visitor request sees the new value (the gate reads the column per request).
async function setCollection(page: Page, on: boolean): Promise<void> {
  await gotoAdminSection(page, 'monitor');
  const toggle = page.getByTestId('monitor-collection-toggle');
  await expect(toggle).toBeVisible();
  const already = (await toggle.getAttribute('aria-checked')) === String(on);
  if (already) return;
  const put = page.waitForResponse(
    (r) => r.url().includes('/api/admin/monitoring') && r.request().method() === 'PUT' && r.ok(),
  );
  await toggle.click();
  await put;
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('monitor · the owner can turn traffic collection off and back on', () => {
  test.beforeAll(async ({ playwright }) => {
    wikiID = await initOwnerWithEntry(playwright);
  });

  test('a visitor read records while ON, records nothing while OFF, and resumes when ON again', async (
    { request, playwright, adminPage },
  ) => {
    // ON (the shipped default): a visitor read lands a row.
    await setCollection(adminPage, true);
    const beforeOn = await readerHits(request);
    await visitAsStranger(playwright, `/api/v1/wiki/${ENTRY.path}`);
    const afterOn = await readerHits(request);
    expect(afterOn, 'a read must be recorded while collection is on').toBe(beforeOn + 1);

    // OFF: the same read records nothing. The switch is the only thing that changed.
    await setCollection(adminPage, false);
    const beforeOff = await readerHits(request);
    await visitAsStranger(playwright, `/api/v1/wiki/${ENTRY.path}`);
    const afterOff = await readerHits(request);
    expect(afterOff, 'a read must NOT be recorded while collection is off').toBe(beforeOff);

    // ON again: recording resumes — proving OFF paused it rather than breaking it.
    await setCollection(adminPage, true);
    const beforeResume = await readerHits(request);
    await visitAsStranger(playwright, `/api/v1/wiki/${ENTRY.path}`);
    const afterResume = await readerHits(request);
    expect(afterResume, 'recording must resume when turned back on').toBe(beforeResume + 1);
  });

  test('the off state survives a reload — it is persisted, not just local UI', async ({ adminPage }) => {
    await setCollection(adminPage, false);
    await gotoAdminSection(adminPage, 'monitor');
    // A fresh navigation re-reads /me; the switch reflects the persisted column, not a stale
    // in-memory flip that a reload would forget.
    await expect(adminPage.getByTestId('monitor-collection-toggle'))
      .toHaveAttribute('aria-checked', 'false');
    // Leave the instance in the shipped default so any later spec on this instance is unsurprised.
    await setCollection(adminPage, true);
  });
});

async function initOwnerWithEntry(playwright: Playwright): Promise<string> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'monitor-offswitch-seed');
  const sid = await initMCP(request, token);
  const { wikiID: id } = await seedWiki(request, token, sid, {
    title: ENTRY.title, body: 'A note behind the switch.', path: ENTRY.path,
  });
  await publishEntry(request, token, sid, { genre: 'wiki', id });
  await request.dispose();
  return id;
}
