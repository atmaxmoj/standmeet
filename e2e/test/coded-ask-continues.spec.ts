// coded-ask-continues.spec.ts —— 首页 Ask 的「有码跳转」全链路:无 session 的访客在
// 首页问一个问题 → 跳 /gate(问题用 ?q= 带过去)→ 填 code 进会话 → 回到 chat 后那个
// **带过去的问题被接着答了**(不丢)。
//
// 现在(bug):首页 ask 发 public session 行内答、问题不串过 gate → **红**。
// 修好后:ask→/gate?q=,gate 发完 session 跳 /?q=,ChatRoom 消费 ?q= 答 → 绿。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'askflow@example.com', password: 'correct-horse-battery-staple',
  handle: 'askflow', fullName: 'Ask Flow Owner',
};
const CODE = 'ASKFLOW-1';
const QUESTION = 'What are you working on?';

test.describe('homepage ask carries through gate into chat and gets answered', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'full', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    await createCode(request, csrf, { code: CODE, label: 'flow', assumed_role_id: role.id });
    const token = await createAPIToken(request, csrf, 'askflow-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      title: 'Current Work', body: 'I am building a notification pipeline.',
      path: 'current-work',
    });
    await request.dispose();
  });

  test('ask on homepage (no code) → gate → enter code → chat answers the carried question',
    async ({ page }) => {
      await goto(page, '/');
      const input = page.locator('[data-testid="chat-input-field"]');
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.fill(QUESTION);
      await input.press('Enter');
      // 落到 gate,问题用 ?q= 带过去。
      await expect(page).toHaveURL(/\/gate\?.*q=/, { timeout: 5_000 });
      // 填码进会话。
      await page.getByTestId('gate-code').fill(CODE);
      await page.getByTestId('gate-visitor-name').fill('Sam');
      await page.getByTestId('gate-code-submit').click();
      // 回到 chat:session 起来 + 带过去的问题被答了(不丢)。
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 8_000 });
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(QUESTION)).toBeVisible();
    });
});
