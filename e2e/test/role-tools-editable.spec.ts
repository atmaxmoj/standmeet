// role-tools-editable.spec.ts —— F-D-9。角色的**工具授权**（skills / 外部 MCP servers）
// 在角色建好之后必须还能改。
//
// /admin/roles 顶上写着 role 捆绑「a set of skills, and which MCP servers it may call」，
// api·mcp 面板注册完一台 server 之后也写着 "then attach it to a role under codes"。可这两份
// 清单**只有「+ NEW ROLE」弹窗里能设一次**：卡片上只剩 `SKILLS 0` / `MCP 0 servers` 两行
// 只读文字（roles/ 目录下只有 Corpus / Description / Dock / Ghost / Provider / Waypoints
// 六个配置组件）。而 `invited` 和 `public` 是 seeder 建的，**从来没经过那个弹窗** ——
// 也就是说每一张留空的码走的那个默认角色，永远拿不到任何一台外部 MCP server。
//
// 这跟 F-A-11 是同一个 bug 的另外两份清单：那次是 corpus 正列表建完就锁死，修法是
// RoleCorpusConfig（卡上 inline 编辑 → 全量 PUT）。后端这一侧从来不缺能力：
// usecase/roles.go 的 Update 一直收 corpus_uris + skill_ids + mcp_server_ids，
// syncRoleJoins 三组 join 一起同步。缺的只是那张脸 —— 于是走 API 的
// tool-roles-mcp.spec.ts 一路绿，而 owner 手上没有那个开关。
//
// 这条守卫走 owner 的真界面，断的是「改完之后它记住了」：重载页面再看那张卡。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'roletools@example.com',
  password: 'role-tools-pass-123',
  handle: 'roletools',
  fullName: 'Role Tools Owner',
};

const SERVER = 'attachable';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// invitedCard —— 内建 `invited` 那张卡。它是每张留空的码走的角色，也是最该能挂工具的一张。
function invitedCard(page: Page) {
  return page.getByTestId('role-row-invited');
}

test.describe('F-D-9 · a role’s tool grants stay editable after it exists', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s，而钩子默认只给 30s
    await initOwner(playwright);
  });

  test('an existing role can be given a registered MCP server, and it sticks',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'roles');
      await adminPage.waitForURL('**/admin/roles', { timeout: 10_000 });

      // 红在这一行：卡片上根本没有这个控件 —— 两份清单建完就锁死了。
      const chip = invitedCard(adminPage).getByTestId(`role-multi-${SERVER}`);
      await expect(chip, 'the invited card offers its MCP servers as an editable list')
        .toBeVisible({ timeout: 5_000 });

      await chip.click();
      await invitedCard(adminPage).getByTestId('role-tools-save').click();

      // 重载再看：断的是「记住了」，不是「点得动」。卡上那一格本来就有（只读的
      // `N servers`），所以这里复用它，不新造 testid。
      await adminPage.reload();
      await expect(invitedCard(adminPage).getByTestId('role-meta-mcp'),
        'the card reports the server it was just given').toHaveText('1 servers');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'role-tools-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'role tools intro.', title: 'Role Tools Intro',
  });
  // 一台注册好的外部 MCP server —— 它是否**可达**跟这条守卫无关，这里断的是授权能不能改。
  const res = await request.post(`${process.env['BACKEND_URL'] ?? 'http://localhost:8000'}/api/admin/mcp-servers`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: SERVER, url: 'https://mcp.example.com/mcp', auth_header_name: '', auth_header_value: '' },
  });
  if (!res.ok()) throw new Error(`register mcp server failed: ${res.status()}`);
  await request.dispose();
}
