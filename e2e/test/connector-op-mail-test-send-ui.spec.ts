// connector-op-mail-test-send-ui.spec.ts —— F-C-12:连接器**自己声明的 owner 操作**要在卡上有面。
//
// 为什么这条守卫存在,而不是又一条打端点的用例:`connectors.mail_test_send` 早就通了 ——
// 声明在 smtp 的 manifest 里,实现在 axisconn/impls.go,路由挂在 /connectors/ops/mail_test_send,
// 而且失败时已经归好类给出三句人话。**但 admin 里没有任何一个控件能触发它**
// (`grep -rn mail_test_send app/src` 一条都没有)。
//
// 五条已有用例碰过这个操作(connector-happy-matrix / connector-openapi-mail /
// connector-provider-agnostic / owner-mcp-parity-connectors / norm-outward-toolset),
// 每一条都是 `request.post(.../ops/…)` 或 MCP callTool ——**没有一条经过浏览器**。
// 一套只驱能力、不驱面的用例,在面根本不存在时照样全绿。所以这条只从 GUI 走:
// 点 owner 能点到的按钮,读 owner 能读到的那句话。
//
// 两条腿都断**正面**结果:一条断没连时那句"下一步是什么",一条断发成之后 Mailpit 真的收到了
// ——UI 上那句 "sent" 是客户端说的话,收件箱里那封信才是回执。

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  armSMTPFault, clearMailpit, configureMailConnector, resetSMTPFault, waitForMailEnvelopeTo,
} from '@/fixtures/mail';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'opface@example.com', password: 'test-password-1234',
  handle: 'opface', fullName: 'Op Face',
};

// OP —— smtp 在自己 manifest 里声明的那个操作,去掉 `connectors.` 前缀后就是路由段,
// 也是卡上那一块的 testid 后缀。写死品类名的是**声明**,不是这一层。
const OP = 'mail_test_send';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// serial —— 第一条用例要的是「还没有邮件连接器」这个状态,第二条把它连上。顺序是用例的一部分。
test.describe.serial('connectors · a declared owner op has a face on the card (F-C-12)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('with no mail connector, the card tells the owner what to do next', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'connectors');
    const op = adminPage.getByTestId(`connector-op-${OP}`);
    // mail 卡上必须有一个「发一封测试信」的动作 —— 没有的话 owner 无从知道邮件通没通。
    await expect(op, 'the mail card must offer a test-send').toBeVisible();

    await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
    await op.getByTestId('connector-op-run').click();

    // 后端 mailFailureReason 归类后的那一句,原样渲到面上。断整句:它的价值就在措辞
    // (「下一步做什么」),而不在"有没有一个 reason 字段"。
    await expect(
      op.getByTestId('connector-op-result'),
      'a failure must name the next step, not merely report failure',
    ).toHaveText('no mail connector is set up yet — connect one first');
  });

  test('a test-send from the card really leaves the building', async ({ adminPage, playwright }) => {
    const request = await playwright.request.newContext();
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await clearMailpit(request);

    await gotoAdminSection(adminPage, 'connectors');
    const op = adminPage.getByTestId(`connector-op-${OP}`);
    await expect(op).toBeVisible();

    const to = 'op-face-receipt@standmeet.test';
    await op.getByTestId('connector-op-field-to').fill(to);
    await op.getByTestId('connector-op-run').click();

    // 成功那句要说明是**哪一种** mail 连接器送的(item check 6:"The success path says
    // which kind delivered it")——smtp 是 protocol kind。
    const result = op.getByTestId('connector-op-result');
    await expect(result, 'a success must name the connector kind that served it')
      .toContainText('protocol');

    // 措辞不许越过 SMTP 提交能担保的东西:250 的意思是「收下了」,不是「送到了」。真中继
    // (Gmail)会照收一个不存在的域名再异步退信,所以这里说 delivered 就是在担保一件它
    // 不知道的事。这一条断的是**没有**那个词 —— 先取文本再判,别用 not.toContainText:
    // 元素还没出现时那个断言也算过。
    expect(
      (await result.innerText()).toLowerCase(),
      'a 250 proves the relay accepted it, never that it was delivered',
    ).not.toContain('delivered');

    // 回执在收件箱里,不在按钮旁边。
    const envelope = await waitForMailEnvelopeTo(request, to);
    expect(envelope.to, 'Mailpit received the test mail — the receipt, not the UI sentence')
      .toContain(to);
    await request.dispose();
  });

  // 中继永久拒收(5xx)跟它暂时不可用,对 owner 是两件事:前者他得改收件人,后者他等一会儿。
  // 以前 SMTP 这条路把两者都归成「暂时不可用」,所以「改收件人」那句**永远出不来** ——
  // 一个永不可能出现的分支跟没写是一回事。这条从卡上驱它。
  test('a relay that rejects the message says to change the recipient, not to wait',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      // 自己把邮件连接器配上,不靠上一条用例留下的状态:单跑这一条时那句话会变成
      // 「还没有邮件连接器」——一个红,但红在装配上,证明不了分类。
      await configureMailConnector(request, OWNER.email, OWNER.password);
      await armSMTPFault(request, { mode: 'permanent', times: 1 });

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
      await op.getByTestId('connector-op-run').click();

      // 5xx 要指向收件人,不能说"过一会儿再试" —— 再试一百次也不会好。
      await expect(
        op.getByTestId('connector-op-result'),
        'a 5xx must point at the recipient, not tell the owner to wait',
      ).toHaveText('the mail provider rejected this message — check the recipient address');

      await resetSMTPFault(request);
      await request.dispose();
    });
});
