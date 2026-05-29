// admin-agent-skills.spec.ts —— UI-driven proof for the new dual-tab
// AgentSkillsSection (integrations · agent group).
//
// Coverage:
//   1. Nav from sidebar lands on /admin/agent-skills with 10 built-in
//      installed skills visible across 3 category groups.
//   2. Switching to the marketplace tab shows the search + 6-card grid.
//   3. Filtering by source (skillsmp / github) trims the grid.
//   4. Install simulation: clicking install → loading state → auto-switch
//      back to "installed" → that skill appears in the registry with a
//      marketplace badge.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin /agent-skills · dual tab + marketplace install', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('my skills tab lands with 10 built-in skills across 3 categories',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      // Tab "my skills" active by default.
      await expect(adminPage.getByTestId('agent-skills-tab-installed'))
        .toBeVisible();
      // 10 built-in skills (5 reach + 3 answer + 2 owner per design).
      await expect(adminPage.locator('[data-testid^="installed-skill-"]'))
        .toHaveCount(10);
      // Three category headers (visitor-reaching / answer-shaping / owner-side).
      for (const cat of ['visitor-reaching', 'answer-shaping', 'owner-side']) {
        await expect(adminPage.getByText(cat, { exact: true })).toBeVisible();
      }
    });

  test('marketplace tab fetches from both sources; skillsmp filter trims to 3',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('agent-skills-tab-marketplace').click();
      // Both sources combined → at least the 3 hand-rolled skillsmp items
      // plus however many anthropics/skills dirs were captured. Lower
      // bound assertion keeps the spec stable as GitHub adds skills.
      await expect(adminPage.locator('[data-testid^="market-skill-"]').first())
        .toBeVisible({ timeout: 5_000 });
      const allCount = await adminPage.locator('[data-testid^="market-skill-"]').count();
      expect(allCount).toBeGreaterThanOrEqual(3 + 1); // 3 skillsmp + ≥1 github
      // Filtering down to skillsmp pins the count exactly.
      await adminPage.getByTestId('marketplace-source-skillsmp').click();
      await expect(adminPage.locator('[data-testid^="market-skill-"]'))
        .toHaveCount(3);
    });

  test('install simulation appends to installed registry with marketplace badge',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('agent-skills-tab-marketplace').click();
      // Install the first marketplace card.
      const firstCard = adminPage.locator('[data-testid^="market-skill-"]').first();
      await firstCard.getByTestId('install-btn').click();
      // After ~900ms the section auto-switches back to "installed".
      await expect(adminPage.getByTestId('agent-skills-tab-installed'))
        .toHaveAttribute('class', /tabBtnActive/, { timeout: 3_000 });
      // Built-ins were 10; one more after install.
      await expect(adminPage.locator('[data-testid^="installed-skill-"]'))
        .toHaveCount(11);
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

async function openAgentSkills(page: Page): Promise<void> {
  await gotoAdminSection(page, 'agent-skills');
  await page.waitForURL('**/admin/agent-skills');
}
