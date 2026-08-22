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

  // 目录规模**不许写成字面量**。这条曾经写死 `20 = 17 github + 3 skillsmp`,而源不止两个:
  // job-board mock 会往目录里追加 `tz-booking`(那条"要连接器"的技能,F-F-4)。加完之后全套里
  // 这条永远红 `Expected 20 / Received 21` —— 而它红的样子跟"分页把一条弄丢了"一模一样。
  // 数目这个事实的家在**那几个源**,抄一份到这里就是第二个家（[[names-that-lie]] 的同族）。
  //
  // 而且这条守的本来也不是"一共几条",是**分页不丢东西**:第一页不倒完、load more 一直到
  // 按钮消失、最后屏上等于目录全量。
  test('marketplace paginates: first page caps the grid, load more appends',
    async ({ adminPage }) => { await assertPaginationKeepsEveryone(adminPage); });

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

// assertPaginationKeepsEveryone —— 第一页不倒完 · 点到按钮消失 · 屏上等于目录全量。
async function assertPaginationKeepsEveryone(page: Page): Promise<void> {
  await openAgentSkills(page);
  await page.getByTestId('skills-tab-marketplace').click();
  await expect(page.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
  const total = await marketplaceSize(page);
  // 目录一页装得下的话,这条用例演不出分页 —— 那是"判不了负",不是通过。
  const loadMore = page.getByTestId('marketplace-load-more');
  await expect(loadMore, `目录只有 ${total} 条,一页就装完了,分页无从演起`).toBeVisible();
  const firstPage = await page.locator(MARKET).count();
  expect(firstPage, '第一页把整份目录一次倒完就不叫分页').toBeLessThan(total);
  // 点到按钮消失为止(目录长到几页都成立);上限只是防死循环。
  for (let i = 0; i < 10 && await loadMore.count() > 0; i += 1) {
    await loadMore.click();
    await expect.poll(() => page.locator(MARKET).count()).toBeGreaterThan(firstPage);
  }
  await expectFamilyCount(page, 'market-skill-', total);
  await expect(loadMore, '没有下一页了,按钮就该走').toHaveCount(0);
}

// marketplaceSize —— 目录一共几条,**问产品自己的检索端点**(一次要完,不分页)。
//
// 它在这里只当量尺:分得对不对由上面那条用例判(第一页不倒完 + 点到没有下一页 + 屏上等于全量)。
// 拿它当量尺是因为"一共几条"的家在那几个源,而源随时会多一条 —— 抄成常数的那一刻就开始过期。
async function marketplaceSize(page: Page): Promise<number> {
  const res = await page.request.get(
    '/api/admin/marketplace/search?limit=500&offset=0',
  );
  expect(res.ok(), `marketplace search 回了 ${res.status()}`).toBe(true);
  const rows: unknown = await res.json();
  expect(Array.isArray(rows), 'marketplace search 该回一个数组').toBe(true);
  return (rows as unknown[]).length;
}

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
  // 换源之后必须等**这一源的**卡真的画出来再读。上面那句等的是「网格里有卡」,而换源的
  // 瞬间屏上还留着上一源的卡 —— 它当场就满足了。而 allInnerTexts() 是一次性读、不重试:
  // 满负载下它读到空数组,红成 `Expected > 0 / Received 0`,看起来像「这一源一条都没有」。
  // 全套里红过一次(1.8 秒就放弃),单跑 8/8 绿 —— 间歇的来源就是这一格。
  await expect(page.getByTestId('market-author').first()).toBeVisible({ timeout: 10_000 });
  const authors = await page.getByTestId('market-author').allInnerTexts();
  expect(authors.length).toBeGreaterThan(0);
  for (const a of authors) {
    expect(a, `versionless card author must not dangle "· v": ${a}`).not.toMatch(/·\s*v\s*$/);
  }
}
