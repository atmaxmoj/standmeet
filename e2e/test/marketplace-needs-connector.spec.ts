// marketplace-needs-connector.spec.ts —— marketplace 卡片的 "needs X connector" 提示必须跟**真**
// connector 状态走，不是硬编码的假连接态。
//
// rot-A4：`AgentSkillsSection` 把常量 `CONNECTED_DEFAULT = ['Email','Calendar']` 当作 `connected`
// 喂给 MarketplaceTab；`MarketplaceCard` 用 `missing = needs.filter(n => !connected.includes(n))`
// 决定提不提示。于是一张需要 "Calendar" 的卡，即便 owner 一个 connector 都没连，也永远不警告。
// 更深一层：`use-marketplace-search.ts` 的 adapter 把每条搜索结果的 `needs` 硬编码成 `[]`（后端 wire
// 里根本没有 needs 字段），所以任何真实搜索结果都拿不到 needs —— 提示永远不可能出现。两头都是假的。
//
// 判据（断好结果）：全新 instance、零 connector，一个声明 needs:['Calendar'] 的 marketplace skill
// 必须显示 "needs Calendar"。今天双重 RED（adapter 丢 needs + CONNECTED_DEFAULT 谎称 Calendar 已连）；
// 修好后 adapter 透传 needs、`connected` 取真 connector 列表（fresh instance = 空）→ GREEN。
//
// seed 说明：没有真实搜索结果带 needs（adapter 硬编码 []），所以这里用 page.route 把
// /api/admin/marketplace/search 钉成一条 needs:['Calendar'] 的 skill。提示元素（MissingHint,
// styles.missing）没有 data-testid —— 按可见文本选它。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'needs-connector@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'needsconnector',
  fullName: 'Needs Connector Owner',
};

// NEEDS_CAL —— 一条声明依赖 Calendar connector 的 marketplace skill（后端 wire 形状 + needs）。
const NEEDS_CAL = {
  id: 'ics-scheduler',
  name: 'ics-scheduler',
  author: 'acme',
  version: '1.0.0',
  category: 'owner',
  description: 'Books meetings straight into the owner calendar.',
  source_url: 'https://example.com/skills/ics-scheduler',
  source: 'github',
  stars: 5,
  needs: ['Calendar'],
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('marketplace · the "needs X connector" hint tracks real connector state', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('fresh instance, no connectors ⇒ a Calendar-needing skill shows its "needs Calendar" hint',
    hintReflectsRealState);
});

// hintReflectsRealState —— 钉住 marketplace 搜索结果为一条依赖 Calendar 的 skill，断言卡片显示提示。
async function hintReflectsRealState({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await page.route(/\/api\/admin\/marketplace\/search/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([NEEDS_CAL]),
  }));

  await openMarketplace(page);

  const card = page.getByTestId(`market-skill-${NEEDS_CAL.id}`);
  await expect(card).toBeVisible({ timeout: 10_000 });

  // 好结果：卡片显示 "needs Calendar"。今天不显示（adapter 丢 needs + Calendar 被谎称已连）→ RED。
  await expect(
    card.getByText('needs Calendar', { exact: false }),
    'a skill that needs Calendar must warn "needs Calendar" when no Calendar connector is wired — '
      + 'the hint must come from real connector state (empty on a fresh instance) and the search '
      + "result's real needs, not a hardcoded connected list or a dropped needs field",
  ).toBeVisible({ timeout: 10_000 });
}

// openMarketplace —— 落 /admin/agent-skills、切到 marketplace tab。mirror admin-agent-skills.spec。
async function openMarketplace(page: Page): Promise<void> {
  // skill registry 合并成一个 /admin/skills（rot-D1）；marketplace 是它的一个 tab。
  await gotoAdminSection(page, 'skills');
  await page.waitForURL('**/admin/skills');
  await page.getByTestId('skills-tab-marketplace').click();
}
