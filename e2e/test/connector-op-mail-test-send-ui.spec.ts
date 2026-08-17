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
//
// F-C-34 —— 失败分类有三支,这里三支都有守卫了:没连接器 / 中继拒收 / **够不着**。
// 第三支是驱 prod 时补的:那次 owner 敲错端口,Connect 给了好句子,紧接着 test-send 却说
// 「你还没配过邮件连接器」。**这条守卫复现不了那一格** —— 连接器仍在 active 槽里时,产品
// 说的是对的那句。prod 上的差别是那次失败的 Connect 把它**踢出了 active 槽**,而「没有 active」
// 正是映射成「还没配」的那个条件(`connector/slots.go:260`)。造出那个状态是 F-C-30 的活,
// 两条同一个根。这里留下的是「够不着这一支活着」的回归守卫。

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  armSMTPFault, clearMailpit, configureMailConnector, connectMailOutcome,
  resetSMTPFault, saveMailCreds, saveMailCredsPartial, waitForMailEnvelopeTo,
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

// DEAD_PORT —— mock 中继那台机器上没人听的一个号。要的是「连得到主机、连不上服务」
// 这一类真失败，不是 DNS 查不到（那是另一类）。
// 先试的是 2525 —— 而 mail-mock 恰好在那儿也听着，于是 connect 返 200，红落在了我的
// 装配断言上而不是产品身上（[[red-in-the-wrong-place]]）。9 是 discard 端口，没人开。
const DEAD_PORT = 9;

// BLACKHOLE_HOST —— 不可路由地址：拨它不会被拒，只会挂着，直到 TCP 自己放弃。
// 「被拒」和「石沉大海」对 owner 是同一件事（都够不着），对**时间**完全不是。
const BLACKHOLE_HOST = '10.255.255.1';

// OUTBOUND_ANSWER_BUDGET_MS —— owner 还愿意盯着屏幕等的时间。prod 上那次是 75 秒，
// 浏览器早就自己超时并改口说「够不着你的实例」，顶栏还翻成 NOT ANSWERING。
const OUTBOUND_ANSWER_BUDGET_MS = 20_000;

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

// 第三种失败：连接器**在**（配过、连过、占着品类槽），但够不着。见文件头 F-C-34 那一段。
// 单独一个 describe：跟上面那组共用文件级的 ownerCredentials 和已 claim 的实例，
// 但自己配连接器、自己造失败，不依赖上面留下的状态。
// 这一组要等真实的拨号失败，其中一条还要等「挂住」的那种（不可路由地址）。预算放在
// describe 上而不是用例体里：fixture 建 adminPage 的时间**也算**在用例超时里，而体内的
// `test.setTimeout` 那时还没执行到 —— 红会落在装配上，看起来像用例慢。
test.describe.configure({ timeout: 150_000 });

test.describe('connectors · a configured-but-unreachable relay names its own class (F-C-34)', () => {
  // 自己 claim，**不蹭上面那组的 beforeAll**。蹭的话单跑这一组（`GREP=`）时实例根本没被
  // claim，adminPage 登不进去 → 30 秒后超时，而红看起来像「产品没在时限内回话」。
  // 我在这上面栽过一次：截图里明明白白写着 `invalid credentials`，我却先去猜拨号把页面挂住了。
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('it says it could not reach the provider, not that none was ever set up',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      // 先配好、连上、占住品类槽 —— 这一格要的是「配过」，不是「没配过」。
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      // 然后把端口改成没人听的那个，重连（会失败）—— owner 敲错一个字的样子。
      await saveMailCreds(request, csrf, { port: String(DEAD_PORT) });
      // 读**回执**，不是 HTTP status：这个端点连不上时照样返 200，把结果写在体里。
      const outcome = await connectMailOutcome(request, csrf);
      expect(outcome.connected, 'connecting to a dead port must not report connected').toBe(false);

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
      await op.getByTestId('connector-op-run').click();

      // 断**正面**：这一类该说的是「够不着，等一会儿」。断「不等于那句 not-configured」
      // 会放过任何第四种措辞，而这一格的价值就在于它说对了哪一类。
      await expect(
        op.getByTestId('connector-op-result'),
        'a configured-but-unreachable relay must not be reported as "never set up"',
      ).toHaveText("couldn't reach the mail provider — please try again later");

      await request.dispose();
    });

  // F-C-36 —— 拨不通有两种：**被拒**（立刻回 connection refused）和**石沉大海**（包被丢掉，
  // 一直等到 TCP 自己超时）。mock 中继给的永远是前者，所以「慢」这件事在它面前不存在；
  // prod 上把端口改错时是后者，backend 等了 **75 秒**才回。
  //
  // 那 75 秒的后果不是「慢一点」：浏览器早就超时，屏幕上显示的是客户端自己那句
  // 「Couldn't reach your instance」，顶栏的健康灯翻成 NOT ANSWERING —— 三句话全是假的，
  // 而后端其实**已经把话说对了**（"temporarily unavailable"），只是没人还在看。
  //
  // 判据因此是**带时限的正确措辞**：owner 必须在还愿意等的时间内，拿到那句对的话。
  // 黑洞地址用不可路由的 10.255.255.1 —— 容器里拨它不会被拒，只会挂着，跟真事故同形。
  test('an outbound dial that hangs still answers the owner in time',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);
      const { csrf } = await login(request, OWNER.email, OWNER.password);
      await saveMailCredsPartial(request, csrf, { host: BLACKHOLE_HOST });

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      await op.getByTestId('connector-op-field-to').fill('nobody@standmeet.test');
      await op.getByTestId('connector-op-run').click();

      await expect(
        op.getByTestId('connector-op-result'),
        'a hung dial must come back with the real reason while the owner is still watching',
      ).toHaveText("couldn't reach the mail provider — please try again later",
        { timeout: OUTBOUND_ANSWER_BUDGET_MS });
      await request.dispose();
    });

  // F-C-37 —— 服务端**答了**，而且答得又快又清楚（`400 to is required`，33ms）。屏幕却说
  // 「Couldn't reach your instance — check your connection and retry」，把 owner 推去查网络，
  // 而他要做的只是往那个框里填个地址。
  //
  // 三态本来是设计对的（「没走通 / 跑了但没成 / 成了」），塌在唯一做判断的那一处：
  // `use-connector-op.ts` 的 `.catch(() => ({ reached: false }))` —— 任何拒绝都算没走通，
  // 包括一个带着完好信封的 400。
  test('a request the server answered names its reason, not the network',
    async ({ adminPage, playwright }) => {
      const request = await playwright.request.newContext();
      await configureMailConnector(request, OWNER.email, OWNER.password);

      await gotoAdminSection(adminPage, 'connectors');
      const op = adminPage.getByTestId(`connector-op-${OP}`);
      // 收件人**留空**就跑 —— owner 最容易做的那个动作。
      await op.getByTestId('connector-op-run').click();

      // 断信封里那句（"to is required"）。断「不等于那句 unreachable」会放过任何第三种
      // 措辞，而这一格的价值正在于它说出了**服务端给的原因**。
      await expect(
        op.getByTestId('connector-op-result'),
        'the server said what was wrong; the screen must say that, not blame the connection',
      ).toContainText(/required/i);
      await request.dispose();
    });
});
