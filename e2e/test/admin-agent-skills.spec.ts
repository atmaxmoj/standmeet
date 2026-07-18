// admin-agent-skills.spec.ts —— UI-driven proof for the AgentSkillsSection,
// now backed by REAL skills + a REAL marketplace install (#48-5).
//
// Coverage:
//   1. My Skills tab lands with the owner's real seeded builtin skills.
//   2. Marketplace tab: real search; the skillsmp source filter trims to 3.
//   3. Install a marketplace skill → backend fetches + parses its SKILL.md →
//      the new real skill lands in My Skills.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const INSTALLED = '[data-testid^="skill-row-"]';
const MARKET = '[data-testid^="market-skill-"]';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin /agent-skills · real installed + marketplace install', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('my skills tab lands with the seeded builtin skills',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await expect(adminPage.getByTestId('skills-tab-installed')).toBeVisible();
      await expect(adminPage.getByTestId('skill-list')).toBeVisible({ timeout: 5_000 });
      // 5 builtins are seeded on claim (code-review / frontend-design / … ).
      const count = await adminPage.locator(INSTALLED).count();
      expect(count).toBeGreaterThanOrEqual(5);
    });

  test('marketplace tab: real search; skillsmp filter trims to 3',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('skills-tab-marketplace').click();
      await expect(adminPage.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId('marketplace-source-skillsmp').click();
      await expect(adminPage.locator(MARKET)).toHaveCount(3);
    });

  test('marketplace paginates: first page caps the grid, load more appends',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('skills-tab-marketplace').click();
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
      await expect(adminPage.getByTestId('skill-list')).toBeVisible({ timeout: 5_000 });
      const before = await adminPage.locator(INSTALLED).count();

      await adminPage.getByTestId('skills-tab-marketplace').click();
      const firstCard = adminPage.locator(MARKET).first();
      await expect(firstCard).toBeVisible({ timeout: 5_000 });
      await firstCard.getByTestId('install-btn').click();

      // Real install (fetch + parse SKILL.md + create) → auto-switch back.
      await expect(adminPage.getByTestId('skills-tab-installed'))
        .toHaveAttribute('class', /tabBtnActive/, { timeout: 10_000 });
      await expect(adminPage.locator(INSTALLED)).toHaveCount(before + 1, { timeout: 5_000 });
    });

  test('paste a SKILL.md in the marketplace tab → it installs into my skills',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await expect(adminPage.getByTestId('skill-list')).toBeVisible({ timeout: 5_000 });
      const before = await adminPage.locator(INSTALLED).count();

      await adminPage.getByTestId('skills-tab-marketplace').click();
      await adminPage.getByTestId('marketplace-manual-toggle').click();
      const md = [
        '---', 'name: hand-pasted', 'description: pasted by the owner', '---',
        '', '# Body', 'do the thing.',
      ].join('\n');
      await adminPage.getByTestId('marketplace-manual-md').fill(md);
      await adminPage.getByTestId('marketplace-manual-install').click();

      // Install completes → auto-switch back to My Skills, count +1, new skill present.
      await expect(adminPage.getByTestId('skills-tab-installed'))
        .toHaveAttribute('class', /tabBtnActive/, { timeout: 10_000 });
      await expect(adminPage.locator(INSTALLED)).toHaveCount(before + 1, { timeout: 5_000 });
      await expect(adminPage.getByText('hand-pasted', { exact: false })).toBeVisible();
    });
});

async function openAgentSkills(page: Page): Promise<void> {
  // skill registry 合并成一个 /admin/skills（rot-D1）；"my skills" tab 就是这份 registry 的列表。
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills');
  await expect(page.getByTestId('skill-list')).toBeVisible({ timeout: 5_000 });
}
