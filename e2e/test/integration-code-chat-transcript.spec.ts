// integration-code-chat-transcript.spec.ts —— full flow: owner creates code →
// visitor uses code → chats → owner sees transcript in admin.
//
// 用户故事：
//   owner 创 code → visitor 用 code 进 ChatRoom → 聊几轮 → owner 在
//   /admin/conversations 看到 transcript + cited bodies

import { test, expect } from '@/fixtures/test';
import type { Browser, BrowserContext, Page, Playwright } from '@playwright/test';

import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'integ-chat@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'integchat',
  fullName: 'Integration Chat Owner',
};

const CODE = 'INTEG-001';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('code → chat → transcript integration', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('visitor chats with code → owner sees transcript in admin',
    async ({ browser }) => {
      // Visitor context (no auth)
      const visitorCtx = await browser.newContext();
      const visitor = await visitorCtx.newPage();
      await enterCodeSession(visitor, CODE);
      await expect(visitor.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // Pure-registration mock: script a corpus_read of the seeded entry so the
      // turn produces a cited transcript (not just a bare final reply).
      const readTag = await scriptMockToolCall(visitor.request, {
        name: 'corpus_read', args: { path: 'integration-intro' },
      });
      const input = visitor.locator('[data-testid="chat-input-field"]');
      await input.fill(`tell me about integration testing${readTag}`);
      await input.press('Enter');
      await expect(visitor.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      await visitorCtx.close();

      const { ctx: ownerCtx, page: owner } = await openLatestTranscript(browser);
      await expect(owner.getByTestId('transcript-body'))
        .toContainText('integration testing', { timeout: 5_000 });
      await ownerCtx.close();
    });

  // F-C-8 —— owner 读到的是 markdown 源码。上面那条只断言"词在"(toContainText),
  // 而正文是渲染过的还是原样打印,它都过。访客那侧和 report 页都渲染同一个字段;
  // 只有 transcript 把 body 塞进 <p> 原样输出。产品页脚承诺的正是 owner 会读它。
  test('the owner reads the answer rendered, not as markdown source',
    async ({ browser }) => {
      const visitorCtx = await browser.newContext();
      const visitor = await visitorCtx.newPage();
      await enterCodeSession(visitor, CODE);
      await expect(visitor.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const replyTag = await scriptMockReplyText(
        visitor.request,
        '## Gate theory\n\nIt is **stages-and-gates** in my notes.\n\n- decidable criteria\n- kill or continue',
      );
      const input = visitor.locator('[data-testid="chat-input-field"]');
      await input.fill(`what is gate theory${replyTag}`);
      await input.press('Enter');
      await expect(visitor.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      await visitorCtx.close();

      const { ctx: ownerCtx, page: owner } = await openLatestTranscript(browser);
      const body = owner.getByTestId('transcript-body');
      await expect(body).toContainText('Gate theory', { timeout: 5_000 });
      // 渲染过 = 标题成了标题、加粗成了 <strong>、列表成了 <li>;
      // 没渲染 = 这些标记原样出现在文字里。
      await expect(body.locator('h2, h1, h3'), '## 变成了标题').not.toHaveCount(0);
      await expect(body.locator('strong'), '** 变成了加粗').not.toHaveCount(0);
      await expect(body.locator('li'), '- 变成了列表项').not.toHaveCount(0);
      await expect(body, '正文里不该出现 markdown 标记本身')
        .not.toContainText('**stages-and-gates**');
      await ownerCtx.close();
    });
});

// openLatestTranscript —— owner 单独开一个浏览器上下文登录,打开最近那场对话的 transcript。
// 两条用例都要走这一段,抽出来免得各写一遍(也让每条用例只剩下它自己要断言的那几行)。
async function openLatestTranscript(
  browser: Browser,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await goto(page, '/admin');
  await page.getByTestId('email').fill(OWNER.email);
  await page.getByTestId('password').fill(OWNER.password);
  await page.getByTestId('submit').click();
  await page.waitForURL('**/admin/**', { timeout: 10_000 });
  await gotoAdminSection(page, 'conversations');
  await page.waitForURL('**/admin/conversations', { timeout: 5_000 });
  await expect(page.getByTestId('conv-table')).toBeVisible();
  const row = page.getByTestId('conv-table').locator('tbody tr').first();
  await expect(row).toBeVisible({ timeout: 5_000 });
  await row.click();
  return { ctx, page };
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'integ-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'integration chat intro content.', title: 'Integration Intro',
    path: 'integration-intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Integration test code',
  });
  await request.dispose();
}
