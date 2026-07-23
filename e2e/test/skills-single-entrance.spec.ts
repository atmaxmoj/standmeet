// skills-single-entrance.spec.ts —— the admin sidebar must have ONE skills entrance, not two
// doors to the same registry.
//
// rot-D1 (HIGH): today `/admin/skills` (nav `admin-nav-skills`, label "skills", jobs group) and
// `/admin/agent-skills` (nav `admin-nav-agent-skills`, label "agent skills", integrations group) are
// two top-level doors to ONE registry — `use-agent-skills.ts` derives its installed list from
// `useSkills().skills` (what `/admin/skills` renders), and a marketplace install writes the same repo
// the persona CRUD list reads. The intended fix (docs/rot-sweep.md D1): merge into a single tabbed
// `/admin/skills` (my skills · marketplace), drop the `agent skills` nav entry, and redirect the old
// `/admin/agent-skills` route to `/admin/skills`.
//
// This spec asserts the MERGED end-state, so it is RED on the current two-page structure and GREEN
// once the merge lands. Each assertion's RED/GREEN reasoning is inline.
//
// testid provenance:
//   • `admin-nav-skills`             — CURRENT, survives the merge (the single door).
//   • `admin-nav-agent-skills`       — CURRENT, MUST BE GONE after the merge (its count→0 is a driver).
//   • `agent-skills-tab-marketplace` — CURRENT, on today's AgentSkillsSection; the merge folds that
//                                      section into SkillsSection, so the marketplace tab appears on
//                                      `/admin/skills`. The implementer may reuse this id or rename to
//                                      `skills-tab-marketplace`; the selector below accepts either so
//                                      the test does not over-constrain the merge.
//   • `market-skill-<id>`            — CURRENT marketplace card id; proves the marketplace actually
//                                      loads on the skills page (not just that a tab button exists).

import { test, expect } from '@/fixtures/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'skills-door@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'skillsdoor',
  fullName: 'Skills Door',
};

// A marketplace tab on /admin/skills — accept the reused id or a renamed one, so the merge picks.
const MARKETPLACE_TAB =
  '[data-testid="skills-tab-marketplace"], [data-testid="agent-skills-tab-marketplace"]';
const MARKET_CARD = '[data-testid^="market-skill-"]';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sidebar · one skills entrance, not two doors to one registry', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  // (1) Exactly ONE skills nav entry. RED now: `admin-nav-agent-skills` renders (count 1) alongside
  //     `admin-nav-skills`. GREEN after merge: the `agent skills` entry is removed → count 0, and the
  //     single `skills` door remains (count 1).
  test('the sidebar has exactly one skills nav entry', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'skills'); // clicks admin-nav-skills → sidebar is rendered
    await expect(
      adminPage.getByTestId('admin-nav-skills'),
      'the single "skills" door must remain',
    ).toHaveCount(1);
    await expect(
      adminPage.getByTestId('admin-nav-agent-skills'),
      'the second "agent skills" door must be gone after the merge (RED now: it still renders)',
    ).toHaveCount(0);
  });

  // (2) The old route redirects to /admin/skills. RED now: `/admin/agent-skills` renders its own
  //     AgentSkillsSection and the URL stays there. GREEN after merge: it forwards to /admin/skills.
  test('visiting /admin/agent-skills lands on /admin/skills', async ({ adminPage }) => {
    await goto(adminPage, '/admin/agent-skills');
    await expect(
      adminPage,
      'the old door must redirect to the merged /admin/skills (RED now: it stays on /admin/agent-skills)',
    ).toHaveURL(/\/admin\/skills(\?.*)?$/, { timeout: 10_000 });
  });

  // (3) The marketplace is reachable as a tab ON /admin/skills. RED now: /admin/skills renders the
  //     persona-only SkillsSection — no marketplace tab, no market cards (both counts 0). GREEN after
  //     merge: the marketplace tab lives on the skills page and its browse grid loads.
  test('on /admin/skills the marketplace is a reachable tab', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'skills');
    const marketplaceTab = adminPage.locator(MARKETPLACE_TAB);
    await expect(
      marketplaceTab,
      'a marketplace tab must exist on /admin/skills after the merge (RED now: none there)',
    ).toHaveCount(1);
    await marketplaceTab.click();
    await expect(
      adminPage.locator(MARKET_CARD).first(),
      'the marketplace browse grid must load on the skills page',
    ).toBeVisible({ timeout: 10_000 });
  });
});
