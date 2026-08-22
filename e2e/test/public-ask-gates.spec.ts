// public-ask-gates.spec.ts —— 无码、无 BYOAI 的纯公开访客**不能直接 chat**。产品
// 模型只有三档:有码 / BYOAI(自带 key) / gate(拦死)。公开访客在首页 Ask 框提问应该
// **跳到 /gate**(填 code 或 BYOAI),而不是用 owner 的 key 直接开聊。
//
// 现在(bug):首页 public mode → issuePublicSession() 直接发 session 开聊 → **红**。
// 修好后:public mode 的 ask 跳 /gate → 绿。

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'gateowner@example.com', password: 'correct-horse-battery-staple',
  handle: 'gateowner', fullName: 'Gate Owner',
};

test.describe('no-code/no-BYOAI visitor cannot chat ungated', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('asking on the public index routes to /gate, no chat happens',
    async ({ page }) => {
      await goto(page, '/');
      // 首页的问答框是 `home-ask-field`（5e439b51 把它跟 ChatRoom 的输入框分了名）。
      const input = page.locator('[data-testid="home-ask-field"]');
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.fill('What are you working on?');
      await input.press('Enter');
      // 跳到 gate(code/BYOAI 入口),不是开聊。
      await expect(page).toHaveURL(/\/gate/, { timeout: 5_000 });
      await expect(page.getByTestId('code-panel')).toBeVisible();
      // 没有产生回答(没绕过 gate 聊起来)。
      await expect(page.locator('[data-testid="answer-body"]')).toHaveCount(0);
    });
});
