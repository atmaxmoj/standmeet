// connector-scope-gates-capability.spec.ts —— F-B-8 ⭐⭐。
// **授出去的范围和放出去的能力，从来没有互相校验过。**
//
// prod 上驱出来的样子（2026-08-18）：owner 只授了 `calendar.readonly`，产品照旧把
// 「订会」摆在访客面前 —— 时段列得出来（读是通的），点下去每一次都 403，而访客被告知
// 「日历服务暂时不可用，过一会儿再问」。403-insufficient-scope 是**永久**的，等多久都不会变。
//
// 这个文件守的是那条**产品自己已经在别处遵守的纪律**：做不到的动作就不提供。
//   · 邮件送不出去 → 批准按钮的位置写 `connect mail to issue codes`（没有按不动的按钮）
//   · 邮件送不出去 → 约成卡上整块确认邮件不渲染（`ownerCanDeliver`）
// 日历这一侧缺的就是同一件事。
//
// ⚠️ **这条现在是目标态红，按 F-B-8 的进度停在 ③ 之后**，所以整组 fixme。
// 停住的原因是**具体的、已经归因到那一行的**（不是「以后再说」）：
//
//   `connectors/google-calendar/spec.yaml` 的三个 operation
//   （freebusy.query / events.insert / events.delete）**一个 `security:` 块都没有** ——
//   两个 scope 只在 `components.securitySchemes` 下声明过一次，那说的是「这个连接器可能
//   会要哪些」，**不是「这个动作需要哪一个」**。于是运行时手里有「授到了什么」
//   （连接行上的 scopes，F-C-33 那条守着它读得回来），却没有「这一步要什么」——
//   **对照的另一半在数据里根本不存在**。
//
//   而 `capreg.DepRegistry` 现在只问 `Connected(ownerID)`：那是「我们手里有一个 token」，
//   不是「我们做得了你授出去的那件事」。
//
// 所以 ④ 的第一步是给 spec 每个 operation 补 `security: [{oauth2: [<需要的 scope>]}]`
// （OpenAPI 本来就有这一格，我们没填），之后「授到的 ⊇ 需要的」才是一句写得出来的判断。
// 在那之前把 scope 名硬编进 Go 只是又造一个会跟 spec 分叉的第二真相。
//
// 解除 fixme 的条件：spec 补完声明 + DepRegistry 按「这个 owner 做不做得了这个动词」放行。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import {
  ensureDisconnected, expectConnected, fillOAuth2Creds,
  openConnectorCard, resetMockOAuthRecord, selectScope,
} from '@/fixtures/connector-card';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'scopegate@example.com',
  password: 'scope-gate-pass-1',
  handle: 'scopegateowner',
  fullName: 'Scope Gate Owner',
};

const OAUTH2_CONNECTOR_ID = 'google-calendar';
const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// ⚠️ 仍然 fixme，但**理由换了，而且换成了更小的一件事**。
//
// 机制链已经通了，并且有 Go 测试守着（`capabilities/pertool_requires_test.go`）：
//   spec 的 per-op `security` → `Spec.ScopesFor` → `openapiCore.CanPerform`（授到的 ⊇ 需要的）
//   → `Slots.CanPerform` → `capreg.NamedOpProvider` → `dropUnperformableTools` 装配时摘工具
//   → manifest 里 `calendar_book` 点名 `calendar:events.insert`，而 `calendar_list_slots` 不点名。
//
// 这个文件断的是**owner 那一面**（写着 connected 的卡要说出「这个授权做不了什么」），
// 那一面还没建。而访客那一面（工具根本不出现）要一个**只授只读的种子**——
// 现有的 `seedCodeVisitorOnConnectedOwner` 走 API 连接、拿的是全量 scope，
// e2e/fixtures 里没有"只授只读"这条路（UI 那条 `selectScope` 有，但它不发码、不起会话）。
//
// 解除条件（两件，各自独立）：
//   1. 连接器卡上出一行 `connector-scope-shortfall`（这个文件现在断的就是它）；
//   2. 给 gcal-setup 加一个只授只读的种子，然后另写一条断「访客拿不到 calendar_book、
//      但仍拿得到 calendar_list_slots」——**后半句是重点**，别只断前半句。
test.describe.fixme('F-B-8 · a read-only grant must not put booking in front of a visitor', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('the owner is told the grant cannot book, on the card that claims to be connected',
    async ({ adminPage: page }) => {
      const card = await connectReadOnly(page);
      // `connected` 说的是「我们手里有一个 token」。owner 读它的时候以为说的是
      // 「这个连接能干它被要求干的事」（[[names-that-lie]]）—— 那两件事在这里正好分叉。
      await expect(card.getByTestId('connector-scope-shortfall'),
        'the card names what this grant cannot do, next to the word connected')
        .toBeVisible();
      await expect(card.getByTestId('connector-scope-shortfall'),
        'and it names the scope to add, not just that something is wrong')
        .toContainText(/calendar\.events/);
    });
});

// connectReadOnly —— 连上日历，只授只读那一个 scope。授权那一步是**真的走一遍 dance**，
// mock 照真 provider 的规矩在 token 响应里回显本次授出的范围（F-C-33 教会它的）。
async function connectReadOnly(page: Parameters<typeof openConnectorCard>[0]) {
  await resetMockOAuthRecord(page);
  const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
  await ensureDisconnected(card);
  await fillOAuth2Creds(card, 'scope-gate-client-id', 'mock-client-secret');
  await selectScope(card, SCOPE_READ, true);
  await selectScope(card, SCOPE_WRITE, false);
  await card.getByTestId('connector-connect-button').click();
  await page.waitForURL('**/admin/connectors**');
  const back = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
  await expectConnected(back);
  return back;
}
