// connector-op-calendar-check-ui.spec.ts —— F-C-16:日历卡上必须有一个「它现在还通吗」。
//
// 邮件连接器有(`connectors.mail_test_send`,声明在 smtp 的 manifest 里),日历一个都没有 ——
// 而两者里恰恰是日历的失效**看不见**:OAuth 授权可以在 Google 那边被撤销、refresh token 可以
// 轮换掉,而卡片会一直写着 "connected",直到某个陌生人来约会议才爆。owner 通不知道。
//
// 这条只从 GUI 走。走 API 的用例在面根本不存在时照样绿(F-C-12 就是这么发现的),
// 而这条守的正是「owner 点得到吗」。
//
// 三条腿都断**正面**结果,而不是「没报错」:
//   1. 没连的时候那句话要说下一步做什么;
//   2. 连上之后回执要是**真数据**(mock 里塞的忙时段数),不是一句 "ok";
//   3. 授权被撤销 → 那句话要读成「去重新连一下」,不是一个 provider 错误码。
//      第 3 条同时是 item check 4 的 Expected,在 mock 上就能复现 —— 不需要真 Google 账号。
//
// RED(实现前):日历 manifest 没声明任何 owner op → 卡上没有这一块 → 第一条就红。

import { test, expect } from '@/fixtures/test';

import { revokeMockGCalToken, setMockBusy } from '@/fixtures/gcal';
import {
  OWNER, connectGCalOnExistingOwner, seedOwnerLoggedIn, teardownSeed, type BaseSeed,
} from '@/fixtures/gcal-setup';
import { gotoAdminSection } from '@/fixtures/navigate';

// OP —— 日历在自己 manifest 里声明的那个操作,去掉 `connectors.` 前缀后就是路由段,
// 也是卡上那一块的 testid 后缀。品类名写死在**声明**里,不在这一层。
const OP = 'calendar_check';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

let seed: BaseSeed | undefined;

// serial —— 第一条要的是「还没连日历」这个状态,后面两条把它连上再弄坏。顺序是用例的一部分。
test.describe.serial('connectors · the calendar card can answer "is it live?" (F-C-16)', () => {
  // 实例只在这里重置一次 —— 后面两条在**同一个** admin 会话下改连接器状态。
  // seedOwnerGCalConnected 会先 resetInstance,那会把浏览器已经登进去的会话打掉。
  test.beforeAll(async ({ playwright }) => {
    seed = await seedOwnerLoggedIn(playwright);
  });

  test.afterAll(async () => {
    await teardownSeed(seed);
  });

  test('with no calendar connected, the card tells the owner what to do next',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      // 没有这一块,owner 就只有 "connected" 那一个词可看 —— 而那个词不查任何东西。
      await expect(op, 'the calendar card must offer a live check').toBeVisible();

      await op.getByTestId('connector-op-run').click();
      await expect(
        op.getByTestId('connector-op-result'),
        'a failure must name the next step, not merely report failure',
      ).toHaveText('no calendar is connected yet — connect one first');
    });

  test('a live check reports what the calendar actually said', async ({ adminPage }) => {
    await connectGCalOnExistingOwner(seed!);
    // 塞两个忙时段。回执要能把它们数出来 —— 「ok」这个词证明不了它真打过 provider,
    // 而数出来的忙时段只能来自那一头。
    await setMockBusy(seed!.request, [
      { start: '2026-09-01T13:00:00Z', end: '2026-09-01T14:00:00Z' },
      { start: '2026-09-02T15:00:00Z', end: '2026-09-02T16:00:00Z' },
    ]);

    await gotoAdminSection(adminPage, 'connectors');
    const op = adminPage.getByTestId(`connector-op-${OP}`);
    await expect(op).toBeVisible();
    // 窗口要覆盖上面那两段(默认往后看的天数不一定够远)。
    await op.getByTestId('connector-op-field-days').fill('120');
    await op.getByTestId('connector-op-run').click();

    await expect(
      op.getByTestId('connector-op-result'),
      'the receipt must carry data only the provider could have supplied',
    ).toContainText('2 busy blocks');

    // 成功那句必须是**这个操作自己**说的。通用那一层原本只会说邮件那句「去收件箱确认」,
    // 对一次日历自检是胡话 —— 这一条守的就是它别再冒出来。
    expect(
      (await op.getByTestId('connector-op-result').innerText()).toLowerCase(),
      'the generic layer must not narrate a calendar check in mail words',
    ).not.toContain('inbox');
  });

  test('a revoked grant reads as a reconnect, not as a provider error code',
    async ({ adminPage }) => {
      // 自己连一遍,不靠上一条留下的状态:单跑这一条时那句话会变成「还没连日历」——
      // 一个红,但红在装配上,证明不了归类。
      await connectGCalOnExistingOwner(seed!);
      await revokeMockGCalToken(seed!.request);

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-run').click();

      // item check 4 的 Expected:撤销要读成一句「重新连一下」。
      await expect(
        op.getByTestId('connector-op-result'),
        'a revoked grant must ask for a reconnect in plain words',
      ).toHaveText('the calendar access was revoked — reconnect it to continue');
    });
});
