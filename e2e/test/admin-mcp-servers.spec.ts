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
});

