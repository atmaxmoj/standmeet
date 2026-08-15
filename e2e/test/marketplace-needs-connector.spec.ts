// marketplace-needs-connector.spec.ts —— marketplace 卡片的 "needs X connector" 提示必须跟**真**
// connector 状态走，不是硬编码的假连接态，也不是一个服务端从不发送的字段。
//
// 这条提示的真值是**推导出来的**，链条三段，三段都在服务端：
//   skill 的 `allowed-tools`（SKILL.md）→ 提供那些工具的能力（manifest 的 `visitor_tools`）
//   → 那个能力要的连接器（manifest 的 `requires`）→ owner 连了没有。
// 中间那一跳以前根本没有家（沙箱能力的访客工具名只有拨号时才知道），所以 `needs` 恒空，
// 提示对任何真卡都不可能出现（F-F-4）。
//
// **不再 page.route 钉假回参。** 上一版把搜索结果换成一条写死 `needs:['Calendar']` 的假 skill，
// 于是它测的是「前端拿到 needs 之后渲得对不对」——而真链路上拿不到，它永远发现不了这一条
// （[[test-covers-capability-not-face]]）。现在走真链路：mock 市场目录里那条 `tz-booking`
// 声明 `allowed-tools: [calendar_book]`，其余技能声明 `corpus_search`（不依赖任何连接器）。
//
// 判据两条，缺一不可：
//   ① 零 connector 的实例上，tz-booking 那张卡说 `needs calendar`；隔壁 pdf 那张**不说**
//      —— 只断①的话，一句对每张卡都渲染的提示也能过。
//   ② 把日历真连上（真 OAuth dance，跟 booking 那几条 spec 同一个 helper），重新搜，
//      提示消失。不动它就分不出「按真状态算的」和「写死了要 calendar」。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { seedOwnerLoggedIn, connectGCalOnExistingOwner, teardownSeed, OWNER, type BaseSeed } from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

// NEEDS_CAL —— mock 市场目录里唯一一条要连接器的技能（mock-stack/job-board/marketplace.go）。
const NEEDS_CAL = 'tz-booking';
// NEEDS_NOTHING —— 抓来的真目录里的一条。它的 allowed-tools 是 corpus_search，不依赖连接器，
// 所以它的 needs 是**空**（答得上，不缺）—— 跟 tz-booking 一起断，才排除「对谁都提示」。
const NEEDS_NOTHING = 'pdf';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('marketplace · the "needs X connector" hint tracks real connector state', () => {
  let seed: BaseSeed | undefined;

  test.beforeAll(async ({ playwright }) => { seed = await seedOwnerLoggedIn(playwright); });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('no connectors ⇒ the calendar-needing skill warns, its neighbour does not; connect ⇒ it clears',
    async ({ adminPage }) => {
      await openMarketplace(adminPage);

      // ① 零 connector：要日历的那张卡说出来。
      await search(adminPage, NEEDS_CAL);
      await expect(
        hintOf(adminPage, NEEDS_CAL),
        '一个要 calendar_book 的技能，在 owner 没连日历时必须说 needs calendar',
      ).toHaveText(/calendar/i, { timeout: 15_000 });

      // 隔壁那张不说。**先断卡片在**：元素还没出现时 toHaveCount(0) 也算通过，
      // 那样这一条断的就不是「它不提示」而是「这一页还没渲染」。
      await search(adminPage, NEEDS_NOTHING);
      await expect(cardOf(adminPage, NEEDS_NOTHING)).toBeVisible({ timeout: 15_000 });
      await expect(
        hintOf(adminPage, NEEDS_NOTHING),
        '不依赖任何连接器的技能不该有提示 —— 有的话说明这句话是对每张卡都渲的',
      ).toHaveCount(0);

      // ② 真把日历连上（真 credentials + 真 OAuth dance + 占用品类槽）。
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

// cardOf / hintOf —— 某张卡，以及它上面的 "needs …" 提示。
function cardOf(page: Page, skillID: string) {
  return page.getByTestId(`market-skill-${skillID}`);
}

function hintOf(page: Page, skillID: string) {
  return cardOf(page, skillID).getByTestId('marketplace-needs-hint');
}

// search —— 市场搜索框。一页 12 条而目录里 20 多条，所以要断哪张卡就先把它搜出来。
async function search(page: Page, query: string): Promise<void> {
  const box = page.getByTestId('marketplace-search');
  await box.fill(query);
  await expect(cardOf(page, query)).toBeVisible({ timeout: 15_000 });
}

// openMarketplace —— 落 /admin/skills、切到 marketplace tab（skill registry 合成一页，rot-D1）。
async function openMarketplace(page: Page): Promise<void> {
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills');
  await page.getByTestId('skills-tab-marketplace').click();
}
