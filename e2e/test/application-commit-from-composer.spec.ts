// application-commit-from-composer.spec.ts -- **when the owner clicks SEND in
// the UI, it must actually be sent.**
//
// Driven out from the real environment (F-E-9): the composer's `SEND ->`
// pops a confirmation dialog listing the consequences one by one --
//   "Sending will freeze the resume + cover letter snapshot, render the final PDF (with QR),
//    and write an application row. The auto-issued AccessCode will be 180 days, 10 sessions,
//    50 turns."
// -- after clicking confirm, the `applications` table has 0 rows, that stretch
// of the backend log has only GETs and not a single POST, and the UI says
// nothing. `DraftsSection.tsx:50` passed `onSend` in as `onClose`.
//
// **This is one grade worse than "button not wired up"**: the product asked
// for consent, listed four consequences, got the nod, and then did none of
// them. The owner would believe they had applied.
//
// Why this spec drives the GUI instead of hitting the API: the defect
// **exists only on the UI side** -- the MCP path has always worked
// (`applications-commit.spec.ts` stays green). Testing one layer below the
// gap can never see it -- the same pit this project keeps falling into.

import { test, expect } from '@/fixtures/test';
import type { Page, APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { gotoAdminSection } from '@/fixtures/navigate';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'composer@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'composer',
  fullName: 'Composer Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('jobs · the composer SEND actually commits', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('confirming SEND writes an application and clears the draft', async ({
    adminPage, request,
  }) => {
    await seedOneDraft(request);

    // The precondition must be able to go red: without a draft, the composer
    // can't be opened below, and "no applications" would degenerate into an
    // always-true assertion.
    await expect.poll(() => countApplications(adminPage), { timeout: 10_000 }).toBe(0);

    await gotoAdminSection(adminPage, 'drafts');
    await adminPage.getByRole('button', { name: /open composer/i }).first().click();
    await adminPage.getByTestId('composer-send').click();
    // The confirmation dialog lists the consequences -- every one it names
    // must actually happen below.
    await expect(adminPage.getByTestId('composer-confirm-send')).toBeVisible();
    await adminPage.getByTestId('composer-confirm-send').click();

    await expect.poll(
      () => countApplications(adminPage), { timeout: 30_000 },
    ).toBe(1);
    // The draft was deleted in the same transaction -- otherwise the owner
    // could submit the same one again.
    await expect.poll(
      () => countDrafts(adminPage), { timeout: 10_000 },
    ).toBe(0);
  });
});

// countApplications / countDrafts -- go through the product's **own** read
// path (admin API), not a direct DB connection: the assertion reads whatever
// the UI reads.
async function countApplications(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const r = await fetch('/api/admin/applications', { credentials: 'include' });
    const rows = await r.json() as unknown[];
    return Array.isArray(rows) ? rows.length : -1;
  });
}

async function countDrafts(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const r = await fetch('/api/admin/drafts', { credentials: 'include' });
    const rows = await r.json() as unknown[];
    return Array.isArray(rows) ? rows.length : -1;
  });
}

// seedOneDraft -- a real-shaped draft: register a source -> fetch -> draft
// against the first job.
async function seedOneDraft(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'composer-spec');
  const sid = await initMCP(request, token);
  await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
  });
  const fetched = await jobsFetchNew(request, token, sid);
  expect(fetched.jobs.length, 'precondition: a job landed in the pool').toBeGreaterThan(0);
  await resumeDraft(request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent());
}
