// drafts-composer.spec.ts —— /admin/drafts: empty state + the composer opens
// the REAL draft detail (#52). Opening a card now fetches GET /api/admin/
// drafts/{id} and loads the actual resume_content, not the old mockDraft.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'composer@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'composer',
  fullName: 'Composer Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /drafts composer', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('empty state → "No drafts pending."',
    async ({ adminPage }) => {
      await openDrafts(adminPage);
      await expect(adminPage.getByText(/No drafts pending/i)).toBeVisible({ timeout: 5_000 });
    });

  test('opening a draft loads its real resume content into the composer',
    async ({ request, adminPage }) => {
      await seedDraft(request);
      await openDrafts(adminPage);
      await expect(adminPage.getByTestId('draft-card')).toBeVisible({ timeout: 5_000 });
      await adminPage.getByRole('button', { name: /open composer/i }).first().click();

      const composer = adminPage.getByTestId('resume-composer');
      await expect(composer).toBeVisible({ timeout: 5_000 });
      // Real seeded resume (sampleResumeContent), not the old mockDraft placeholder.
      // Name renders lowercased via CSS text-transform — match case-insensitively.
      await expect(composer).toContainText(/alice anderson/i);
      await expect(composer).toContainText('71%');
      await expect(composer).not.toContainText('Lucerna');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function seedDraft(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'composer-seed');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Composer Board', config: { company: 'airbnb' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs');
  await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
}

async function openDrafts(page: Page): Promise<void> {
  await gotoAdminSection(page, 'drafts');
  await page.waitForURL('**/admin/drafts');
}
