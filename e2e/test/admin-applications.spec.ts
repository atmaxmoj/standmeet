// admin-applications.spec.ts —— admin applications: empty state, card after
// commit, detail modal with timeline.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'apps@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'apps',
  fullName: 'Apps Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin applications UI', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('empty state → "No applications" message',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      await expect(adminPage.getByText(/no applications/i)).toBeVisible();
    });

  test('after commit → application card appears',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      await seedApplication(request);
      await request.dispose();
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      // At least one row/card should appear (not the empty state)
      await expect(adminPage.getByText(/no applications/i)).toHaveCount(0, { timeout: 5_000 });
    });

  // F-E-3 — a just-committed application card shows `SENT —`: a label asserting "already
  // submitted", paired with a date that doesn't exist. The truth is in the database:
  // `applications.status` is created as 'pending' and `submitted_at` is NULL, and **no code
  // ever changes them** — job-loop step 4 (the real Playwright submission) does not exist
  // yet, so nothing in today's product can make the word "sent" true. The frontend is even
  // further off: its enum is silent/reviewing/replied/rejected/offer (whether the recruiter
  // replied), which is entirely disjoint from the backend's pending/submitted, so every row
  // falls back to rendering as SILENT.
  //
  // This assertion asks for exactly one thing: the card reports what the product **actually
  // knows** — committed (the date is real), submission not yet recorded.
  test('a committed application reports what the product actually knows (F-E-3)',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      await seedApplication(request);
      await request.dispose();
      await gotoAdminSection(adminPage, 'applications');
      const card = adminPage.getByTestId('applications-list').locator('> div').first();
      await expect(card).toBeVisible({ timeout: 5_000 });

      const today = new Date().toISOString().slice(0, 10);
      await expect(card, 'commit 是真发生过的,日期必须是真的').toContainText(today);

      // Read the text once, then assert. `.not.toContainText()` retries, and it also passes
      // during the instant before the element even appears — an assertion that can never go
      // red. This version turns it into a judgment against a fixed string.
      const cardText = (await card.innerText()).toLowerCase();
      expect(
        cardText,
        '没有任何代码会把它变成 submitted,所以卡片不许把 commit 说成 sent',
      ).not.toMatch(/\bsent\b/);
      expect(
        cardText,
        'recruiter 有没有回,产品根本没有写入口 —— 不许兜底编一个 SILENT 出来',
      ).not.toMatch(/\bsilent\b/);
      await expect(
        card.getByTestId(/^application-state-/),
        '状态说的是投递这条轴:刚 commit = committed',
      ).toHaveText(/committed/i);

      const headerText = (
        await adminPage.getByTestId('section-header').innerText()
      ).toLowerCase();
      expect(headerText, '标题也一样:数的是申请,不是已投出的申请').not.toMatch(/\bsent\b/);
    });
});

async function seedApplication(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'apps-seed');
  const sid = await initMCP(request, token);
  // Use 'airbnb' company — mock job board has data for it
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Apps Test Board',
    config: { company: 'airbnb' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs for airbnb');
  const { view } = await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
  await applicationsCommit(request, token, sid, view.draft_id);
}
