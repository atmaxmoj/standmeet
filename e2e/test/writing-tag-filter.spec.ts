// writing-tag-filter.spec.ts —— writings index tag filter + empty state + CTA.
//
// 用户故事：
//   1. tag filter → click tag → only writings with that tag shown
//   2. tag filter → click same tag again → clear filter (show all)
//   3. 0 writings → empty state
//   4. AskCorpusCTA → click → jump to /
//   5. RecommendedRail → shows top 2 writings + clickable

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'writing-tag@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'writingtag',
  fullName: 'Writing Tag Owner',
};

test.describe('writings index: tag filter + empty state', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('click tag → filter → click again → clear',
    async ({ request, page }) => {
      await seedWritings(request);
      await goto(page, '/writings');
      // Should see both writings initially
      await expect(page.locator('[data-writing-card]')).toHaveCount(2, { timeout: 5_000 });
      // Click the "alpha" tag filter
      await page.getByTestId('writings-tag-alpha').click();
      // Only alpha-tagged writing visible
      await expect(page.locator('[data-writing-card="alpha-writing"]')).toBeVisible();
      await expect(page.locator('[data-writing-card="beta-writing"]')).toHaveCount(0);
      // Click alpha again to clear
      await page.getByTestId('writings-tag-alpha').click();
      // Both visible again
      await expect(page.locator('[data-writing-card]')).toHaveCount(2, { timeout: 5_000 });
    });
});

test.describe('writings index: empty state', () => {
  test.beforeAll(async ({ playwright }) => {
    await initEmptyOwner(playwright);
  });

  test('0 writings → empty state shown',
    async ({ page }) => {
      await goto(page, '/writings');
      await expect(page.getByTestId('writings-empty')).toBeVisible({ timeout: 5_000 });
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

async function initEmptyOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function seedWritings(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'writing-tag-seed');
  const sid = await initMCP(request, apiToken);
  await callTool(request, apiToken, sid, 'writing_create', {
    slug: 'alpha-writing', title: 'Alpha Writing',
    excerpt: 'Alpha content.', body_md: 'Alpha body.',
    cover_headline: 'alpha.', cover_sub: 'tagged.', cover_hue: 'amber',
    tags: ['alpha'], publish: true,
  });
  await callTool(request, apiToken, sid, 'writing_create', {
    slug: 'beta-writing', title: 'Beta Writing',
    excerpt: 'Beta content.', body_md: 'Beta body.',
    cover_headline: 'beta.', cover_sub: 'tagged.', cover_hue: 'violet',
    tags: ['beta'], publish: true,
  });
}
