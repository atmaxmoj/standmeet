// ai-provider-config.spec.ts —— owner 在 /admin/api-mcp 配置自己的 AI
// provider + key。明文 key 不回读；toast 反馈成功。
//
// Phase 1 只验"key 能存能清，UI 状态切换正确"。Phase 2 跑 visitor 真聊
// 走 Anthropic 路径在后续 spec 里。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe.serial('owner configures AI provider + key from /admin/api-mcp', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('pick anthropic + paste key → key set; clear → mock + key gone',
    async ({ adminPage: page }) => {
      await gotoAdminSection(page, 'api · mcp');

      await page.getByTestId('ai-provider-anthropic').click();
      await page.getByTestId('ai-provider-key').fill('sk-ant-fake-test-key');
      await page.getByTestId('ai-provider-save').click();
      await expect(page.getByTestId('toast-success').filter({ hasText: 'AI provider saved' }))
        .toBeVisible();
      // 重新 load 一遍 panel，看 key_configured 状态进来 (placeholder 切换)。
      await page.reload();
      await expect(page.getByTestId('ai-provider-key'))
        .toHaveAttribute('placeholder', /already set/);

      await page.getByTestId('ai-provider-clear').click();
      await expect(page.getByTestId('toast-success').filter({ hasText: 'AI provider cleared' }))
        .toBeVisible();
      await expect(page.getByTestId('ai-provider-clear')).toHaveCount(0);
    });
});

