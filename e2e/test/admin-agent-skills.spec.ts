// admin-agent-skills.spec.ts —— UI-driven proof for the AgentSkillsSection,
// now backed by REAL skills + a REAL marketplace install (#48-5).
//
// Coverage:
//   1. My Skills tab lands with the owner's real seeded builtin skills.
//   2. Marketplace tab: real search; the skillsmp source filter trims to 3.
//   3. Install a marketplace skill → backend fetches + parses its SKILL.md →
//      the new real skill lands in My Skills.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const INSTALLED = '[data-testid^="installed-skill-"]';
const MARKET = '[data-testid^="market-skill-"]';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin /agent-skills · real installed + marketplace install', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('my skills tab lands with the seeded builtin skills',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await expect(adminPage.getByTestId('agent-skills-tab-installed')).toBeVisible();
      await expect(adminPage.getByTestId('installed-skills-grid')).toBeVisible({ timeout: 5_000 });
      // 5 builtins are seeded on claim (code-review / frontend-design / … ).
      const count = await adminPage.locator(INSTALLED).count();
      expect(count).toBeGreaterThanOrEqual(5);
    });

  test('marketplace tab: real search; skillsmp filter trims to 3',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('agent-skills-tab-marketplace').click();
      await expect(adminPage.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId('marketplace-source-skillsmp').click();
      await expect(adminPage.locator(MARKET)).toHaveCount(3);
    });

  test('marketplace paginates: first page caps the grid, load more appends',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('agent-skills-tab-marketplace').click();
      await expect(adminPage.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
      // PAGE_LIMIT = 12; 'all' returns 17 github + 3 skillsmp = 20 → page 1 is 12.
      await expect(adminPage.locator(MARKET)).toHaveCount(12);
      await adminPage.getByTestId('marketplace-load-more').click();
      await expect(adminPage.locator(MARKET)).toHaveCount(20);
      await expect(adminPage.getByTestId('marketplace-load-more')).toHaveCount(0);
    });

  test('install a marketplace skill → it lands in my skills',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await expect(adminPage.getByTestId('installed-skills-grid')).toBeVisible({ timeout: 5_000 });
      const before = await adminPage.locator(INSTALLED).count();

      await adminPage.getByTestId('agent-skills-tab-marketplace').click();
      const firstCard = adminPage.locator(MARKET).first();
      await expect(firstCard).toBeVisible({ timeout: 5_000 });
      await firstCard.getByTestId('install-btn').click();

      // Real install (fetch + parse SKILL.md + create) → auto-switch back.
      await expect(adminPage.getByTestId('agent-skills-tab-installed'))
        .toHaveAttribute('class', /tabBtnActive/, { timeout: 10_000 });
      await expect(adminPage.locator(INSTALLED)).toHaveCount(before + 1, { timeout: 5_000 });
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

async function openAgentSkills(page: Page): Promise<void> {
  await gotoAdminSection(page, 'agent-skills');
  await page.waitForURL('**/admin/agent-skills');
}
