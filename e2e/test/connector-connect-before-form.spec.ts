// connector-connect-before-form.spec.ts —— **Connect 不许在卡还不知道自己是哪种连接时就能按。**
//
// ①🔴 全量第 436 条红在这里(connector-happy-matrix,openapi calendar + oauth2)。产物里那张卡:
// 方案写着 `oauth2`、CLIENT ID / CLIENT SECRET 两格空着、底下一句红字
// "The connection test failed." —— 而这句话**只属于非 dance 那条路**
// (`runNonDanceConnect` 的兜底文案)。一个 oauth2 连接器走完了 bearer/apiKey 的分支。
//
// ②🎯 `useConnectorCard.connect()` 按 `authType` 分叉,而 `authType` 要等
// `/{id}/credential-form` 回来才有值 —— 在那之前它是空串,于是分到「非 dance」那一支。
// 而 Connect 按钮从**第一帧**就是活的:卡片刚挂上(装配完成之后表单让位给卡,是最快的那种),
// 谁先按谁就走错路。装配路上这两件事挨着发生,所以那条 e2e 时不时红一次;
// owner 手动时同样撞得到,只是他不会去看是哪一支跑了 —— 他看到的是「连不上」。
//
// ③🧪 这条 spec 把那一帧做成确定的:把 credential-form 的**回参**扣住(请求真发出去了、
// 答案在手上、浏览器还没拿到),这时候的卡就是那一帧的样子。扣到什么时候由测试放行,
// 不由计时决定 —— 计时要跟机器快慢赛跑,而输掉的那一遍长得跟通过一模一样。
//
// 判据分两层:按钮在那一帧不该是活的(结构上不可能按错),放行之后 oauth2 必须真的走 dance。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { openConnectorCard, fillOAuth2Creds, expectConnected } from '@/fixtures/connector-card';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'connect-form@example.com', password: 'correct-horse-battery-staple',
  handle: 'connectform', fullName: 'Connect Form Owner',
};

// 内置的 oauth2 连接器(calendar 品类,跑 dance)。挑 oauth2 是因为**只有它**能把
// 「走错分支」变成一个看得见的错误结局:非 dance 分支对 oauth2 连接器必然连不上。
const OAUTH2_CONNECTOR_ID = 'google-calendar';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('connector card · the frame before its form arrives', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('Connect is dead while credential-form is in flight; oauth2 then dances',
    async ({ adminPage: page }) => {
      const marks = { fetched: [] as number[], delivered: [] as number[] };
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => { release = resolve; });
      // **先真发出去,再扣住回参**。扣在 continue() 之前只是把请求整体推迟,
      // 那样卡片根本不会渲染出「表单未知」的那一帧 —— 测的就是另一条路。
      await page.route('**/credential-form*', async (route) => {
        const res = await route.fetch();
        const body = await res.body();
        marks.fetched.push(Date.now());
        await held;
        await route.fulfill({ response: res, body });
        marks.delivered.push(Date.now());
      });

      const card = await openConnectorCard(page, OAUTH2_CONNECTOR_ID);
      const connect = card.getByTestId('connector-connect-button');
      await expect(connect, 'the card is on screen').toBeVisible();
      // 自证:此刻表单确实还在途。等的是 fetched(答案已经在手上、被扣住)而不是
      // 「进了处理器」—— 后者早于 `route.fetch()` 落地,那一刻窗口还没开始。
      await expect.poll(() => marks.fetched.length, { timeout: 10_000 }).toBeGreaterThan(0);
      expect(marks.delivered.length, 'the form has not reached the browser yet').toBe(0);
      await expect(
        connect,
        'while the card cannot know which branch to take, Connect must not be pressable',
      ).toBeDisabled();
      expect(marks.delivered.length, 'the window was still open during that check').toBe(0);
      release();
      // 窗口用完就把路由摘掉。dance 是**整页跳转**,它会把还压在处理器里的那个回参丢弃 ——
      // 处理器于是在 `res.body()` 上炸("Response has been disposed"),而炸的原因跟被测的
      // 那件事毫无关系。拦截只该活在它要制造的那一帧里。
      //
      // 摘之前先等那一笔真的送出去:`unroute` 会把还没落地的那条路由**当场接管**,
      // 于是我自己的 fulfill 撞上「Route is already handled」—— 放行和摘除是两件事,
      // 顺序反了就等于没放行。
      await expect.poll(() => marks.delivered.length, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.unroute('**/credential-form*');

      // 放行之后照常连:按钮活过来,oauth2 走 dance(整页跳去同意页再回来),卡变 connected。
      // 「按不动」不许是把功能拿掉换来的。
      await expect(connect).toBeEnabled({ timeout: 15_000 });
      await fillOAuth2Creds(card, 'mock-client-id', 'mock-client-secret');
      await connect.click();
      await page.waitForURL('**/admin/connectors**');
      await expectConnected(card);
    });
});
