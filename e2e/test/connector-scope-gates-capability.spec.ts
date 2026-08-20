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
// **文件里有两组，状态不一样，别混着看**（2026-08-20）：
//
//   1. 访客那一面 —— **已落地、已跑绿**：只授只读的实例，`calendar_book` / `calendar_cancel`
//      不进会话工具表，而 `calendar_list_slots` 照旧在。机制链是
//      spec 的 per-op `security:` → `Spec.ScopesFor` → `openapiCore.CanPerform`（授到的 ⊇ 需要的）
//      → `Slots.CanPerform` → `capreg` 装配时按工具摘。
//   2. owner 那一面 —— **仍 fixme**：写着 `connected` 的卡上还没有那一行
//      `connector-scope-shortfall`（「这个授权做不了 X，去补 Y」）。那个界面没建，
//      不是断言写错。
//
// 红态证过（不是「写完就绿」）：把 manifest 里 `calendar_book` 的 `requires` 拿掉再跑，
// 第一句断言当场红，且红的样子正确 —— `calendar_book` 回到表里，`calendar_list_slots`
// 仍在（[[assertion-that-cannot-fail]]）。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { sessionToolNames } from '@/fixtures/capabilities';
import {
  ensureDisconnected, expectConnected, fillOAuth2Creds,
  openConnectorCard, resetMockOAuthRecord, selectScope,
} from '@/fixtures/connector-card';
import { GCAL_SCOPE_READ, GCAL_SCOPE_WRITE } from '@/fixtures/gcal';
import { seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed } from '@/fixtures/gcal-setup';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'scopegate@example.com',
  password: 'scope-gate-pass-1',
  handle: 'scopegateowner',
  fullName: 'Scope Gate Owner',
};

const OAUTH2_CONNECTOR_ID = 'google-calendar';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// ⚠️ 仍然 fixme，理由只剩一件、而且很具体：**卡上那一行还没建**。
//
// 底下的机制是通的（上面那一组每次都在跑），差的是 owner 这一侧的呈现 ——
// `connected` 说的是「我们手里有一个 token」，owner 读它的时候以为说的是「这个连接能干
// 它被要求干的事」（[[names-that-lie]]），而这两件事在只读授权下正好分叉。
//
// 解除条件：连接器卡渲出 `connector-scope-shortfall`，写明缺哪个 scope。
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

// ── 访客那一面：做不到的动作不出现，做得到的照旧在 ────────────────────────
//
// 这一组**不 fixme**：机制已落地（`3c2333cc`），2026-08-20 在 prod 上也用眼睛验过
// —— 真把 Google 授权收窄成 `calendar.readonly`，产品自己的日志 `agent turn start … tools`
// 从 38 掉到 34、恢复授权后回到 38。这里守的是同一件事，只是让它每次都跑。
//
// **两句断言缺一不可，第二句才是重点**：只断「订不到」的话，把整个 booker 藏掉也能过 ——
// 而那是拿掉一个**做得到**的动作来修「提供了做不到的动作」，是另一个缺陷，不是修复
// （[[gate-scope-forces-architecture]]）。
test.describe('F-B-8 · a read-only grant drops the write tools and keeps the read ones', () => {
  let seed: CodedSeed | undefined;

  test.afterAll(async () => { await teardownSeed(seed); });

  test('booking leaves the visitor session, slot listing stays', async ({ playwright }) => {
    test.setTimeout(120_000);
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { scopes: [GCAL_SCOPE_READ] });
    // 先把整张表取下来再判。`not.toContain` 直接打在 locator 上时，元素还没出现也算通过
    // （[[negated-assertion-passes-while-absent]]）；这里拿到的是一个已经存在的数组。
    const tools = await sessionToolNames(seed.request, seed.visitor.session_token);

    expect(tools, 'the grant cannot insert an event, so booking is never offered')
      .not.toContain('calendar_book');
    expect(tools, 'nor cancel one')
      .not.toContain('calendar_cancel');
    expect(tools, 'but the grant CAN read free/busy — listing slots must survive')
      .toContain('calendar_list_slots');
  });
});

// connectReadOnly —— 连上日历，只授只读那一个 scope。授权那一步是**真的走一遍 dance**，
// mock 照真 provider 的规矩在 token 响应里回显本次授出的范围（F-C-33 教会它的）。
async function connectReadOnly(page: Parameters<typeof openConnectorCard>[0]) {
  await resetMockOAuthRecord(page);
  const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
  await ensureDisconnected(card);
  await fillOAuth2Creds(card, 'scope-gate-client-id', 'mock-client-secret');
  await selectScope(card, GCAL_SCOPE_READ, true);
  await selectScope(card, GCAL_SCOPE_WRITE, false);
  await card.getByTestId('connector-connect-button').click();
  await page.waitForURL('**/admin/connectors**');
  const back = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
  await expectConnected(back);
  return back;
}
