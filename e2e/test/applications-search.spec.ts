// applications-search.spec.ts — the owner can find an application fast (a recruiter calls about a
// job). Seeds one committed application through the real path, then drives the search field: a
// matching query keeps the row, a non-matching one hides it and shows the "no matches" state.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { resumeDraft, sampleResumeContent, applicationsCommit } from '@/fixtures/resume';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'appsearch@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'appsearch',
  fullName: 'App Search Owner',
};

// seedOneApplication — register a source → fetch → draft → commit, the real Phase-3 path. Returns
// the committed application's company (what the owner would type to find it).
async function seedOneApplication(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'appsearch');
  const sid = await initMCP(request, token);
  const source = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
  });
  const fetched = await jobsFetchNew(request, token, sid, source.id);
  const job = fetched.jobs[0]!;
  const drafted = await resumeDraft(request, token, sid, job.cache_id, sampleResumeContent());
  await applicationsCommit(request, token, sid, drafted.view.draft_id);
  return job.company;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('applications · search', () => {
  let company = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    company = await seedOneApplication(request);
    await request.dispose();
  });

  test('a matching query keeps the row; a non-matching one hides it and says so',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'applications');
      const list = page.getByTestId('applications-list');
      await expect(list).toBeVisible({ timeout: 10_000 });
      const rowCount = await page.locator('[data-testid^="application-row-"]').count();
      expect(rowCount, 'the seeded application is listed').toBeGreaterThan(0);

      const search = page.getByTestId('applications-search');
      await expect(search, 'the search field is present').toBeVisible();

      // A query matching the company keeps the row on screen.
      await search.fill(company.slice(0, 3));
      await expect(page.locator('[data-testid^="application-row-"]').first()).toBeVisible();

      // A query that matches nothing hides the rows and shows the no-matches state.
      await search.fill('zzz-no-such-company-xyz');
      await expect(page.getByTestId('applications-no-matches')).toBeVisible();
      await expect(page.locator('[data-testid^="application-row-"]')).toHaveCount(0);
    });
});
