// admin-corpus-count-scale.spec.ts —— F-L-4 guard: the dashboard KPI + sidebar badge
// count the WHOLE corpus, not just the first paginated page.
//
// Real-env finding F-L-4: with 170 raw notes the dashboard showed "50 unprocessed" and the
// sidebar badge showed "raw 50" — the count was `fetchedRows.filter(...).length` over the
// first page (defaultCorpusLimit = 50), not a COUNT(*). Small fixtures (<50 notes) never
// exceeded one page, so every existing spec was green. This seeds > one page and asserts the
// counts equal the real total.
//
// RED before the fix: kpi-unprocessed / badge-raw show 50 (the page cap). GREEN after: 60.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { callTool } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'count-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'countowner',
  fullName: 'Count Owner',
};

// One page is 50 (defaultCorpusLimit). Seed past it so a page-limited count is provably wrong.
const RAW_COUNT = 60;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin corpus counts at scale (F-L-4)', () => {
  test.beforeAll(async ({ playwright }) => {
    await seedManyRaw(playwright);
  });

  test('dashboard "unprocessed" KPI counts the whole corpus, not one page',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByTestId('kpi-unprocessed')).toContainText(String(RAW_COUNT), {
        timeout: 5_000,
      });
    });

  test('sidebar raw badge counts the whole corpus, not one page',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByTestId('badge-raw')).toContainText(String(RAW_COUNT), {
        timeout: 5_000,
      });
    });

  test('raw section header counts the whole corpus, not one page',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      await expect(adminPage.getByRole('heading', { level: 1 }))
        .toContainText(String(RAW_COUNT), { timeout: 5_000 });
    });

  test('section header has a space before the count separator (UX-12)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'raw');
      const h1 = adminPage.getByRole('heading', { level: 1 });
      await expect(h1).toBeVisible({ timeout: 5_000 });
      // "raw · N unprocessed", not the concatenated "raw· N" (a11y/text layer).
      expect(await h1.textContent()).toMatch(/raw\s+·/);
    });
});

async function seedManyRaw(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'count-seed');
  const sid = await initMCP(request, apiToken);
  // raw_dump without a promote leaves each note unprocessed. Batch to keep beforeAll fast.
  const indices = Array.from({ length: RAW_COUNT }, (_, i) => i);
  const batch = 10;
  for (let start = 0; start < indices.length; start += batch) {
    await Promise.all(indices.slice(start, start + batch).map((i) =>
      callTool(request, apiToken, sid, 'corpus.create',
        { genre: 'raw', body: `raw scale note ${i}`, source: 'mcp:e2e', tags: [] })));
  }
  await request.dispose();
}
