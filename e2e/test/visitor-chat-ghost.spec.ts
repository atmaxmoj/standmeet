// visitor-chat-ghost.spec.ts —— H.13.d: code-accessor 进 chat 看到灰色
// ghost text，Tab 接受填进 input，Escape 循环到下一条。
//
// 用户故事：
//   1. owner 建 code 时填 suggested_questions
//   2. visitor 持 code 进 chat → 输入框 placeholder = 第一条 ghost
//   3. visitor 按 Tab → input.value = 第一条 (autofill, 不 auto-send)
//   4. visitor 清空 → 按 Escape → ghost cycle 到第二条
//
// Backend SSE `suggestions` 帧 (follow-up) 的追加路径走单独 endpoint
// spec 验证 (agent-turn-endpoint.spec.ts assertSuggestionsFrame)；这条
// spec 只覆盖 UI 行为。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'ghost-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghostowner',
  fullName: 'Ghost Owner',
};

const CODE = 'GHOST-001';

// SUGGESTED —— owner 在建码时填的初始 ghost 队列。前端按 [0] 渲；按
// Escape cycle 到 [1]。
const SUGGESTED = [
  'What did you ship last quarter?',
  'Why are you considering a move?',
  'What does the team look like?',
];

test.describe('visitor chat ghost text · H.13.d', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code visitor → input placeholder = ghost[0]; Tab fills input',
    async ({ page }) => {
      await enterChatWithCode(page);
      const input = page.getByTestId('chat-input-field');
      await expect(input, 'ghost = suggested[0]')
        .toHaveAttribute('data-ghost', SUGGESTED[0]!, { timeout: 5_000 });
      await expect(input, 'placeholder mirrors ghost')
        .toHaveAttribute('placeholder', SUGGESTED[0]!);
      await input.focus();
      await input.press('Tab');
      await expect(input, 'Tab 把 ghost 填进 input (不 submit)')
        .toHaveValue(SUGGESTED[0]!);
    });

  test('Escape cycle 到下一条 ghost (input 已空)',
    async ({ page }) => {
      await enterChatWithCode(page);
      const input = page.getByTestId('chat-input-field');
      await expect(input).toHaveAttribute('data-ghost', SUGGESTED[0]!, { timeout: 5_000 });
      await input.focus();
      await input.press('Escape');
      await expect(input, 'cycle 后 ghost = suggested[1]')
        .toHaveAttribute('data-ghost', SUGGESTED[1]!);
      await expect(input, 'placeholder 跟着切')
        .toHaveAttribute('placeholder', SUGGESTED[1]!);
    });
});

async function enterChatWithCode(page: Page): Promise<void> {
  await goto(page, `/?code=${CODE}`);
  await page.waitForResponse((res) =>
    res.url().endsWith('/api/v1/sessions') && res.status() === 200);
  await dismissNamePicker(page);
  // code-mode visitor 落到 ChatRoom (page-shell.useChatModeDetect)；
  // chat-input form 渲在 sticky composer 里。
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function dismissNamePicker(page: Page): Promise<void> {
  const skipBtn = page.getByRole('button', { name: /skip/i });
  const visible = await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  visible && await skipBtn.click();
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'ghost-role', description: 'ghost spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'ghost', assumed_role_id: role.id,
    suggested_questions: SUGGESTED,
  });
  await request.dispose();
}
