// admin-mcp-servers.spec.ts —— api·mcp 区的 external MCP servers CRUD。
//
// 用户故事:owner 把别处拿到的 MCP server 装载进来 → 列表出现 → 可删。
// 真后端 /mcp-servers(POST/GET/DELETE),UI 驱动。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'mcp-crud@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mcpcrud',
  fullName: 'MCP CRUD Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin external MCP servers CRUD', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('add an MCP server → appears in list → remove → gone',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      const panel = adminPage.getByTestId('mcp-servers-panel');
      await expect(panel).toBeVisible({ timeout: 5_000 });

      await panel.getByTestId('mcp-server-name').fill('my-tools');
      await panel.getByTestId('mcp-server-url').fill('https://mcp.example.com/mcp');
      await panel.getByTestId('mcp-server-add').click();

      const list = adminPage.getByTestId('mcp-servers-list');
      await expect(list.getByText('my-tools')).toBeVisible({ timeout: 5_000 });
      await expect(list.getByText('https://mcp.example.com/mcp')).toBeVisible();

      await list.getByRole('button', { name: 'remove' }).click();
      await expect(list.getByText('my-tools')).toHaveCount(0);
    });

  // F-D-8 —— 注册成功之后，那一行只有名字和 URL：**没有任何东西说这台 server 够不够得着，
  // 也没有它广播了哪些工具**。owner 挂一台 server 给一张码，是在替访客做决定，而他手上
  // 唯一的凭据是自己刚才粘的那个 URL 有没有粘错。
  //
  // 产品**知道**这两件事 —— 会话装配时它真去 dial 并列 tools（`ext_<name>_*` 就是这么来的），
  // 只是从来不在这一页说出来。跟 F-C-16 同一形状：日历连接器那张卡也曾经只写 `connected`，
  // 而没有任何办法去问一句；解法是给它一个**只读探针**。这里照抄那个先例。
  //
  // 判据：点了探针之后，那一行必须报出**真结果** —— 够得着就说出工具数（用 dev 栈里那台
  // 真 mcp-server-mock，它真会答 tools/list），够不着就说出真原因。不许只是「点了没反应」。
  //
  // 探针不能长在 marketplace 域里：那台 server 的认证头是密文，而**域这一侧从不解封**
  // （`capreg_ext_mcp.go:150` 那句注释写得很清楚：「开封发生在实现 MCPServerGetter 的那一侧
  // (组装根)。这里以前有一个 buildAuthHeaders,自己 cryptobox.Decrypt:装配是内侧,内侧不解封」）。
  // 所以正确的形状是跟 hostdesk 同一个：**域声明一个 port**（"问一下这台 server 答不答话、
  // 有哪些工具"），**组装根实现它**（它已经有 `mcpclient.Dial` + `ListTools`，
  // `capreg_ext_mcp.go:149-163` 就是那段代码）。= port + 根接线 + op + 路由 + 面 + 守卫。
  //
  // 已按那条路做完：port(marketplace/usecase) + 根接线(cmd/server/mcp_probe.go)
  // + op(mcp_server_check) + 路由(POST /mcp-servers/{id}/check) + 面(这颗 check) + 本守卫。
  test('a registered server can be asked whether it answers, and what it offers',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      const panel = adminPage.getByTestId('mcp-servers-panel');
      await expect(panel).toBeVisible({ timeout: 5_000 });

      await panel.getByTestId('mcp-server-name').fill('probe-me');
      await panel.getByTestId('mcp-server-url').fill('http://mcp-server-mock:9100/mcp');
      await panel.getByTestId('mcp-server-add').click();

      // 定位到**那一行**（li），不是整张列表：check 的 testid 在行内唯一，
      // 多一台 server 时才不会撞上 strict mode。
      const row = adminPage.getByTestId('mcp-servers-list')
        .locator('li').filter({ hasText: 'probe-me' });
      await expect(row).toBeVisible({ timeout: 5_000 });
      await row.getByTestId('mcp-server-check').click();

      // 真答上了 = 报得出工具数。0 也是个答案，但这台 mock 有工具，所以断的是 ≥1 ——
      // 只断「出现了一句话」的话，一句写死的「checked」也能过。
      //
      // 断的是 `check-result` 的**文本**：那个 testid 只挂在答完之后那一行上，
      // 进行时是另一个（`check-pending`）。第一版把两种状态挂在同一个名字上，
      // 于是这里读到的是「asking…」—— 名字说它是结果，手上却是个进行时。
      await expect(
        row.getByTestId('mcp-server-check-result'), '探针要报出真结果',
      ).toHaveText(/[1-9]\d*\s+tools?/i, { timeout: 20_000 });
    });

  // F-D-15 —— **「够不着」和「够到了、它不收这份凭据」被说成同一句话，而且是句假话。**
  //
  // 真环境撞到的（驱 ext-mcp check 4 时）：把真 Hugging Face MCP 那台重新注册、故意配一个
  // 坏 token，点 CHECK → 屏幕上是 **`no answer — internal error`**，HTTP 500。
  // 五个字里两句假话：对面**答了话**（HF 回的是 401 Unauthorized），而且那**不是**我们内部的错。
  //
  // ②🎯 后端日志把真相说全了，然后把它扔了：
  //   `dial mcp server: mcp server unreachable: streamable: initialize: transport error:
  //    authorization required; sse: … 405`
  // `mcpclient.Dial` 对**一切**失败都盖 `ErrUnreachable`（dial.go:53），而 `authorization
  // required` 是 mcp-go 的类型化哨兵、就在链子里；`mcpServerErr` 的分类表里没有它这一类，
  // 于是落到 `fp.OpErr` → 500 → 前端 `checkFailed` 把它渲成 `no answer — internal error`。
  // 跟 F-R-12 / F-C-42 同族：把「拒绝」说成「拨不通」（[[collapsed-error-class-kills-its-own-branch]]）。
  //
  // 判据要能判负，所以两条一起断：**坏凭据那条必须说「它拒绝了」**，
  // **而真够不着那条必须还说「没答话」** —— 只断前者的话，把所有失败都改叫「被拒绝」也能过
  // （[[red-in-the-wrong-place]]）。两条都不许出现 `internal error`：owner 粘错东西是常态，
  // 不是这台实例坏了。
  test('a server that answers but refuses the credential says so, not "internal error" (F-D-15)',
    ({ adminPage }) => expectProbeSays(adminPage, {
      name: 'refuses-me',
      url: 'http://mcp-server-mock:9100/mcp-auth',
      auth: ['X-Mock-Auth', 'not-the-right-token'],
      says: /rejected|refused/i,
    }));

  test('a server that truly cannot be reached still reads as no answer (F-D-15)',
    ({ adminPage }) => expectProbeSays(adminPage, {
      name: 'nobody-home',
      // 没有任何东西监听这个端口 —— 连接直接被拒，跟「答了话但拒绝」是两回事。
      url: 'http://mcp-server-mock:9199/mcp',
      says: /no answer/i,
    }));
});

// expectProbeSays —— 注册一台 server、点 CHECK、读那一行说了什么。
async function expectProbeSays(
  page: Page,
  want: { name: string; url: string; auth?: [string, string]; says: RegExp },
): Promise<void> {
  await gotoAdminSection(page, 'api-mcp');
  const panel = page.getByTestId('mcp-servers-panel');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  await panel.getByTestId('mcp-server-name').fill(want.name);
  await panel.getByTestId('mcp-server-url').fill(want.url);
  if (want.auth !== undefined) {
    await panel.getByTestId('mcp-server-auth-name').fill(want.auth[0]);
    await panel.getByTestId('mcp-server-auth-value').fill(want.auth[1]);
  }
  await panel.getByTestId('mcp-server-add').click();

  const row = page.getByTestId('mcp-servers-list')
    .locator('li').filter({ hasText: want.name });
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.getByTestId('mcp-server-check').click();

  const said = row.getByTestId('mcp-server-check-result');
  await expect(said, '探针要说出到底发生了什么').toContainText(want.says, { timeout: 25_000 });
  // 先等到上面那句成立，元素必定在了，这条否定断言才判得了负
  // （[[negated-assertion-passes-while-absent]]）。
  await expect(said, 'owner 粘错东西不是这台实例坏了').not.toContainText(/internal error/i);
}

