// marketplace-needs-connector.spec.ts —— a marketplace card's "needs X connector" hint must track
// **real** connector state, not a hardcoded fake connection status, nor a field the server never sends.
//
// The truth of this hint is **derived**, through a three-hop chain, all of it on the server:
//   the skill's `allowed-tools` (SKILL.md) → the capability that provides those tools (manifest's `visitor_tools`)
//   → the connector that capability needs (manifest's `requires`) → whether the owner has connected it.
// The middle hop used to have no home at all (a sandboxed capability's visitor tool
// names are only known once it's dialed), so `needs` was permanently empty, and the
// hint could never appear on any real card (F-F-4).
//
// **No more page.route pinning fake responses.** The previous version swapped the
// search result for a fake skill with a hardcoded `needs:['Calendar']`, so it was
// testing "given needs, does the frontend render it correctly" — and since the real
// pipeline never produces that value, it could never catch this bug
// ([[test-covers-capability-not-face]]). Now it goes through the real pipeline: the
// mock marketplace catalog's `tz-booking` entry declares `allowed-tools: [calendar_book]`,
// while the other skills declare `corpus_search` (no connector dependency).
//
// Two criteria, both required:
//   ① On an instance with zero connectors, the tz-booking card says `needs calendar`;
//      its neighbor, the pdf card, **does not** — asserting only ① would also pass a
//      hint that's rendered on every card.
//   ② Actually connect the calendar (a real OAuth dance, the same helper the booking
//      specs use), search again, and the hint disappears. Without this step you can't
//      tell "computed from real state" apart from "hardcoded to need calendar".

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { seedOwnerLoggedIn, connectGCalOnExistingOwner, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

// NEEDS_CAL —— the one skill in the mock marketplace catalog that needs a connector (mock-stack/job-board/marketplace.go).
const NEEDS_CAL = 'tz-booking';
// NEEDS_NOTHING —— an entry from the real fetched catalog. Its allowed-tools is
// corpus_search, no connector dependency, so its needs is **empty** (fully answerable,
// nothing missing) — asserting it alongside tz-booking is what rules out "hints on everything".
const NEEDS_NOTHING = 'pdf';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('marketplace · the "needs X connector" hint tracks real connector state', () => {
  let seed: BaseSeed | undefined;

  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('no connectors ⇒ the calendar-needing skill warns, its neighbour does not; connect ⇒ it clears',
    async ({ adminPage }) => {
      await openMarketplace(adminPage);

      // ① Zero connectors: the calendar-needing card says so.
      await search(adminPage, NEEDS_CAL);
      await expect(
        hintOf(adminPage, NEEDS_CAL),
        '一个要 calendar_book 的技能，在 owner 没连日历时必须说 needs calendar',
      ).toHaveText(/calendar/i, { timeout: 15_000 });

      // Its neighbor doesn't. **Assert the card is present first**: toHaveCount(0)
      // would also pass while the element hasn't rendered yet, and then this
      // wouldn't be asserting "it doesn't hint" but "the page hasn't rendered yet".
      await search(adminPage, NEEDS_NOTHING);
      await expect(cardOf(adminPage, NEEDS_NOTHING)).toBeVisible({ timeout: 15_000 });
      await expect(
        hintOf(adminPage, NEEDS_NOTHING),
        '不依赖任何连接器的技能不该有提示 —— 有的话说明这句话是对每张卡都渲的',
      ).toHaveCount(0);

      // ② Actually connect the calendar (real credentials + a real OAuth dance + occupying the category slot).
      if (seed === undefined) throw new Error('seed missing');
      await connectGCalOnExistingOwner(seed);

      await openMarketplace(adminPage);
      await search(adminPage, NEEDS_CAL);
      await expect(cardOf(adminPage, NEEDS_CAL), '重新搜完那张卡还在')
        .toBeVisible({ timeout: 15_000 });
      await expect(
        hintOf(adminPage, NEEDS_CAL),
        '日历连上之后这句话必须消失 —— 不消失说明它是写死的，不是按真状态算的',
      ).toHaveCount(0);
    });
});

// cardOf / hintOf —— a given card, and the "needs …" hint on it.
function cardOf(page: Page, skillID: string) {
  return page.getByTestId(`market-skill-${skillID}`);
}

function hintOf(page: Page, skillID: string) {
  return cardOf(page, skillID).getByTestId('marketplace-needs-hint');
}

// search —— the marketplace search box. A page holds 12 entries while the catalog has 20+, so search for the card being asserted before checking it.
async function search(page: Page, query: string): Promise<void> {
  const box = page.getByTestId('marketplace-search');
  await box.fill(query);
  await expect(cardOf(page, query)).toBeVisible({ timeout: 15_000 });
}

// openMarketplace —— lands on /admin/skills, switches to the marketplace tab (skill registry is merged into one page, rot-D1).
async function openMarketplace(page: Page): Promise<void> {
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills');
  await page.getByTestId('skills-tab-marketplace').click();
}
