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
import { expectFamilyCount } from '@/fixtures/testid-family';

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

  // SkillsMP 会把同一个技能的多语言变体各列一行,所以后端按 name+author 去重
  // (dedupePreferEnglish)。这条断的是**去重之后的条数** —— 不去重的话 owner 看到的
  // 每个技能都出现两遍。
  test('marketplace tab: real search; skillsmp filter trims to 3',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('skills-tab-marketplace').click();
      await expect(adminPage.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId('marketplace-source-skillsmp').click();
      await expectFamilyCount(adminPage, 'market-skill-', 3);
    });

  // F-F-2 —— GitHub 那一源的每一张卡片都印着 `★ 0`,而 `ghContentToMarketSkill` 里那句注释
  // 自己就写明了原因:"GitHub skills are folders in one repo → no per-skill star count"。
  // 也就是说 0 的意思是**不知道**,而屏幕上写的是"零颗星"。owner 拿这个数字挑技能。
  // 空值不是 0(empty-is-not-json-null 的同一课)——不知道就别印。
  //
  // 顺带钉住这个数到底在数什么:它是技能所在**仓库**的星数,所以同一个仓库里的兄弟技能
  // 共享同一个数(真环境里 openclaw 那六个都是 385119)。标签必须这么说,否则一个跨行相同的
  // 数字读起来就是"这些技能一样受欢迎"。
  test('an unknown star count is not printed as zero (F-F-2)',
    async ({ adminPage }) => { await assertStarsHonest(adminPage); });

  // UX-13 residual: SkillsMP skills carry no version → the footer renders author alone,
  // not a dangling "· v" with nothing after it.
  test('marketplace: a versionless skill shows author, not a bare "· v"',
    async ({ adminPage }) => { await assertNoBareVersion(adminPage); });

  // 'all' = 17 github + 3 skillsmp = 20(两边 name+author 不撞,跨源不会被去重掉)。
  test('marketplace paginates: first page caps the grid, load more appends',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('skills-tab-marketplace').click();
      await expect(adminPage.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
      // PAGE_LIMIT = 12; 'all' returns 17 github + 3 skillsmp = 20 → page 1 is 12.
      await expectFamilyCount(adminPage, 'market-skill-', 12);
      await adminPage.getByTestId('marketplace-load-more').click();
      await expectFamilyCount(adminPage, 'market-skill-', 20);
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

// assertStarsHonest —— F-F-2 的主体。GitHub 源报不出 per-skill 星数(它自己的注释就这么写),
// 那就一个数都别印;skillsmp 有真数就印,并且说清楚数的是**仓库**。
async function assertStarsHonest(page: Page): Promise<void> {
  await openAgentSkills(page);
  await page.getByTestId('skills-tab-marketplace').click();
  await page.getByTestId('marketplace-source-github').click();
  await expect(page.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
  const cards = await page.locator(MARKET).all();
  for (const card of cards) {
    await expect(card, 'GitHub 源没有 per-skill 星数,那就一个数都别印').not.toContainText('★');
  }
  await page.getByTestId('marketplace-source-skillsmp').click();
  await expect(page.locator(MARKET).first().getByTestId('market-stars'))
    .toHaveText(/★\s*\d+\s*repo/i);
}

async function assertNoBareVersion(page: Page): Promise<void> {
  await openAgentSkills(page);
  await page.getByTestId('skills-tab-marketplace').click();
  await page.getByTestId('marketplace-source-skillsmp').click();
  await expect(page.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
  const authors = await page.getByTestId('market-author').allInnerTexts();
  expect(authors.length).toBeGreaterThan(0);
  for (const a of authors) {
    expect(a, `versionless card author must not dangle "· v": ${a}`).not.toMatch(/·\s*v\s*$/);
  }
}
