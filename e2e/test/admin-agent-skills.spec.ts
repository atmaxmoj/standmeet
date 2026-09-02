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

  // SkillsMP lists each language variant of the same skill as its own row, so the
  // backend dedupes by name+author (dedupePreferEnglish). This asserts the count
  // **after dedup** — without dedup, the owner would see every skill twice.
  test('marketplace tab: real search; skillsmp filter trims to 3',
    async ({ adminPage }) => {
      await openAgentSkills(adminPage);
      await adminPage.getByTestId('skills-tab-marketplace').click();
      await expect(adminPage.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
      await adminPage.getByTestId('marketplace-source-skillsmp').click();
      await expectFamilyCount(adminPage, 'market-skill-', 3);
    });

  // F-F-2 — every card from the GitHub source prints `★ 0`, and the comment in
  // `ghContentToMarketSkill` itself states why: "GitHub skills are folders in one repo
  // → no per-skill star count". So 0 here means **unknown**, but the screen renders it
  // as "zero stars". The owner uses this number to pick skills.
  // An unknown value is not 0 (the same lesson as empty-is-not-json-null) — if it's
  // unknown, don't print it.
  //
  // Also pin down what this number actually counts: it's the star count of the
  // **repo** the skill lives in, so sibling skills in the same repo share the same
  // number (in the real environment, all six openclaw skills read 385119). The label
  // must say so, otherwise the same number repeated across rows reads as "these skills
  // are equally popular".
  test('an unknown star count is not printed as zero (F-F-2)',
    async ({ adminPage }) => { await assertStarsHonest(adminPage); });

  // UX-13 residual: SkillsMP skills carry no version → the footer renders author alone,
  // not a dangling "· v" with nothing after it.
  test('marketplace: a versionless skill shows author, not a bare "· v"',
    async ({ adminPage }) => { await assertNoBareVersion(adminPage); });

  // The catalog size **must never be a literal**. This used to hard-code
  // `20 = 17 github + 3 skillsmp`, but there are more than two sources:
  // the job-board mock appends `tz-booking` to the catalog (the "needs a connector"
  // skill, F-F-4). Once that's added, this line is permanently red across the whole
  // suite as `Expected 20 / Received 21` — and it reads exactly like "pagination
  // dropped an item".
  // The fact of the count lives in **those sources**; copying it here creates a
  // second home for it (same family as [[names-that-lie]]).
  //
  // And what this test actually guards is not "how many total", it's **pagination
  // loses nothing**: the first page doesn't dump everything at once, load more
  // continues until the button disappears, and the final on-screen count equals
  // the full catalog.
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

// assertPaginationKeepsEveryone — first page doesn't dump everything · click until the
// button disappears · on-screen count equals the full catalog.
async function assertPaginationKeepsEveryone(page: Page): Promise<void> {
  await openAgentSkills(page);
  await page.getByTestId('skills-tab-marketplace').click();
  await expect(page.locator(MARKET).first()).toBeVisible({ timeout: 5_000 });
  const total = await marketplaceSize(page);
  // If the whole catalog fits on one page, this test can't demonstrate pagination —
  // that's "unable to fail", not a pass.
  const loadMore = page.getByTestId('marketplace-load-more');
  await expect(loadMore, `目录只有 ${total} 条,一页就装完了,分页无从演起`).toBeVisible();
  const firstPage = await page.locator(MARKET).count();
  expect(firstPage, '第一页把整份目录一次倒完就不叫分页').toBeLessThan(total);
  // Click until the button disappears (holds no matter how many pages the catalog
  // spans); the cap is only there to prevent an infinite loop.
  for (let i = 0; i < 10 && await loadMore.count() > 0; i += 1) {
    await loadMore.click();
    await expect.poll(() => page.locator(MARKET).count()).toBeGreaterThan(firstPage);
  }
  await expectFamilyCount(page, 'market-skill-', total);
  await expect(loadMore, '没有下一页了,按钮就该走').toHaveCount(0);
}

// marketplaceSize — how many items the catalog has, **asked from the product's own
// search endpoint** (one request, no pagination).
//
// Used here only as a yardstick: whether pagination is correct is judged by the test
// above (first page doesn't dump everything + click until no more pages + on-screen
// count equals the full total). It's used as a yardstick because "how many total"
// lives in those sources, and a source can gain an item any time — copying it into a
// constant here starts going stale the moment it's written.
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
  // The skill registry was merged into one /admin/skills (rot-D1); the "my skills"
  // tab is just this registry's list.
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills');
  await expect(page.getByTestId('skill-list')).toBeVisible({ timeout: 5_000 });
}

// assertStarsHonest — the body of F-F-2. The GitHub source can't report a per-skill
// star count (its own comment says so), so print no number at all; skillsmp has a
// real number, so print it, and make clear it's counting the **repo**.
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
  // After switching sources, must wait for **this source's** cards to actually render
  // before reading. The wait above only checks "there's a card in the grid", and right
  // at the moment of switching, the previous source's card is still on screen — that
  // satisfies it immediately. allInnerTexts() reads once with no retry: under full
  // load it can read an empty array, going red as `Expected > 0 / Received 0`, which
  // looks like "this source has zero items". It went red once in the full suite (gave
  // up after 1.8s) but passed 8/8 running alone — this is the source of the flake.
  await expect(page.getByTestId('market-author').first()).toBeVisible({ timeout: 10_000 });
  const authors = await page.getByTestId('market-author').allInnerTexts();
  expect(authors.length).toBeGreaterThan(0);
  for (const a of authors) {
    expect(a, `versionless card author must not dangle "· v": ${a}`).not.toMatch(/·\s*v\s*$/);
  }
}
