// admin-mcp-servers.spec.ts —— api·mcp 区的 external MCP servers CRUD。
//
// 用户故事:owner 把别处拿到的 MCP server 装载进来 → 列表出现 → 可删。
// 真后端 /mcp-servers(POST/GET/DELETE),UI 驱动。

import { test, expect } from '@/fixtures/test';

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
  // ⚠️ fixme —— **判据是对的，缺的是机制，而机制不是一处改动**（F-D-8）。
  //
  // 探针不能长在 marketplace 域里：那台 server 的认证头是密文，而**域这一侧从不解封**
  // （`capreg_ext_mcp.go:150` 那句注释写得很清楚：「开封发生在实现 MCPServerGetter 的那一侧
  // (组装根)。这里以前有一个 buildAuthHeaders,自己 cryptobox.Decrypt:装配是内侧,内侧不解封」）。
  // 所以正确的形状是跟 hostdesk 同一个：**域声明一个 port**（"问一下这台 server 答不答话、
  // 有哪些工具"），**组装根实现它**（它已经有 `mcpclient.Dial` + `ListTools`，
  // `capreg_ext_mcp.go:149-163` 就是那段代码）。= port + 根接线 + op + 路由 + 面 + 守卫。
  //
  // 我把判据留在这里而不是删掉：它是这条 check 唯一说得清的成功形态。下一轮照上面那条路做完，
  // 去掉 fixme 即可 —— 它现在红在「没有这颗按钮」上，做完就红在真结果上。
  test.fixme('a registered server can be asked whether it answers, and what it offers',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'api-mcp');
      const panel = adminPage.getByTestId('mcp-servers-panel');
      await expect(panel).toBeVisible({ timeout: 5_000 });

      await panel.getByTestId('mcp-server-name').fill('probe-me');
      await panel.getByTestId('mcp-server-url').fill('http://mcp-server-mock:9100/mcp');
      await panel.getByTestId('mcp-server-add').click();

      const row = adminPage.getByTestId('mcp-servers-list').filter({ hasText: 'probe-me' });
      await expect(row).toBeVisible({ timeout: 5_000 });
      await row.getByTestId('mcp-server-check').click();

      // 真答上了 = 报得出工具数。0 也是个答案，但这台 mock 有工具，所以断的是 ≥1 ——
      // 只断「出现了一句话」的话，一句写死的「checked」也能过。
      const result = row.getByTestId('mcp-server-check-result');
      await expect(result, '探针要报出真结果').toBeVisible({ timeout: 20_000 });
      const said = (await result.innerText()).trim();
      expect(said, `探针说的是 "${said}"`).toMatch(/[1-9]\d*\s+tools?/i);
    });
});

