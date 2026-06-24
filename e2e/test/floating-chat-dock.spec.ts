// floating-chat-dock.spec.ts —— FloatingChatDock on writings and wiki pages.
//
// 用户故事：
//   1. writings index → pill 可见 (有 session 时)
//   2. 无 session → pill 不渲染
//   3. 点 pill → 面板展开 → input 可见
//   4. 输入 → ask → answer 渲
//   5. 关闭面板 → pill 恢复

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto, enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'dock-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'dockowner',
  fullName: 'Dock Owner',
};

const CODE = 'DOCK-001';

test.describe('FloatingChatDock on writings/wiki pages', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('public visitor → no floating pill on /writings (no funded chat path)',
    async ({ page }) => {
      // Public visitor has no session → no inference funding (owner won't pay
      // for random visitors, no BYOAI key). Pill hidden until visitor either
      // absorbs a code or adds BYOAI on /gate.
      await goto(page, '/writings');
      await expect(page.getByTestId('floating-dock-pill')).toHaveCount(0);
    });

  test('with session → pill visible → click → expand → chat → close',
    async ({ page }) => {
      // Absorb code first
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Navigate to writings
      await goto(page, '/writings');
      // Pill should be visible
      const pill = page.getByTestId('floating-dock-pill');
      await expect(pill).toBeVisible({ timeout: 5_000 });
      // Click pill → panel expands
      await pill.click();
      const panel = page.getByTestId('floating-chat-panel');
      await expect(panel).toBeVisible({ timeout: 3_000 });
      const input = panel.locator('input');
      await expect(input).toBeVisible();
      // Close panel
      await page.getByTestId('floating-dock-pill').click();
      await expect(panel).toBeHidden({ timeout: 3_000 });
      // Pill still there
      await expect(pill).toBeVisible();
    });

  // #35:浮窗复用主 chat 的 ChatTranscript —— 大 chat 的渲染行为在小 chat 上也成立。
  // 同 testid:answer-pending(throbber)+ answer-body(ChatMarkdown),不再是简陋纯文本。
  test('dock reuses main-chat rendering: ask → throbber + answer-body (no reset)',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await goto(page, '/writings');
      await page.getByTestId('floating-dock-pill').click();
      const panel = page.getByTestId('floating-chat-panel');
      await expect(panel).toBeVisible({ timeout: 3_000 });
      // 没有 reset 按钮(owner 要求去掉)。
      await expect(panel.getByRole('button', { name: /reset/i })).toHaveCount(0);

      const input = page.getByTestId('floating-chat-input');
      await input.fill('tell me about yourself');
      await input.press('Enter');
      // 跟主 chat 同款 throbber + answer-body(真 ChatMarkdown 渲染管线)。
      await expect(panel.getByTestId('answer-pending')).toBeVisible({ timeout: 5_000 });
      await expect(panel.getByTestId('answer-body')).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByTestId('answer-body')).toContainText(/./);
    });

  // #35 完备性(owner 原则):大 chat 的 tool-cards + citations + throbber-clears
  // 全流程在小 chat(浮窗)上也成立 —— 同 seed(Lucerna)、同问句、同 testid。
  test('dock full flow: corpus_search 卡 + hit + citations + throbber 清除', dockFullFlow);

  // #36:doc 页浮窗发问 → turn 请求带当前 doc 的 doc_context(plumbing;指代质量走 eval)。
  test('location-aware: dock turn 带当前 doc 的 doc_context', dockSendsDocContext);
});

async function dockFullFlow({ page }: { page: Page }): Promise<void> {
  await enterCodeSession(page, CODE);
  await goto(page, '/writings');
  await page.getByTestId('floating-dock-pill').click();
  const panel = page.getByTestId('floating-chat-panel');
  await expect(panel).toBeVisible({ timeout: 3_000 });

  const input = page.getByTestId('floating-chat-input');
  await input.fill('tell me about lucerna');
  await input.press('Enter');

  // corpus_search 卡(retrieval ui:// 沙盒 iframe,折叠)→ 进 frame 展开看 hit。
  await expect(panel.getByTestId('mcp-app-card-corpus_search'))
    .toBeVisible({ timeout: 20_000 });
  const frame = panel.frameLocator('[data-testid="mcp-app-card-corpus_search"]');
  await frame.locator('summary').first().click();
  const hit = frame.locator('[data-testid="tool-card-hit"][data-path="projects/lucerna"]');
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('Lucerna');
  // corpus_read 不渲卡(Citation 接管);citations 出现。
  await expect(panel.getByTestId('tool-card-corpus_read')).toHaveCount(0);
  await expect(panel.getByTestId('citations')).toBeVisible();
  // citation 行是跳那篇公开页的外链。
  await panel.getByTestId('citations').locator('summary').click();
  const row = panel.locator('[data-testid="citation-row"][data-citation-path="projects/lucerna"]');
  await expect(row).toHaveAttribute('href', '/wiki/projects/lucerna');
  await expect(row).toHaveAttribute('target', '_blank');
  // 答案落地后 throbber 消失。
  await expect(panel.getByTestId('tool-throbbers')).toHaveCount(0, { timeout: 20_000 });
}

// dockSendsDocContext —— 从 wiki landing 的浮窗发问,turn 请求带 doc_context
// (title/path/genre),后端注进 instruction 让 AI 解析「this/这篇」指代。
type TurnBody = { doc_context?: { title: string; path: string; genre: string } };

async function dockSendsDocContext({ page }: { page: Page }): Promise<void> {
  await enterCodeSession(page, CODE);
  let turnBody: TurnBody | null = null;
  await page.route('**/api/v1/agent/turn', async (route) => {
    turnBody = route.request().postDataJSON() as TurnBody;
    await route.continue();
  });
  await goto(page, '/wiki/projects/lucerna');
  await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('floating-dock-pill').click();
  const input = page.getByTestId('floating-chat-input');
  await input.fill('tell me more about this');
  await input.press('Enter');
  await expect(page.getByTestId('floating-chat-panel').getByTestId('answer-body'))
    .toBeVisible({ timeout: 15_000 });
  // turnBody 只在 route 闭包里赋值 → TS CFA 把它窄成 null；读处显式 cast 回 union。
  expect((turnBody as TurnBody | null)?.doc_context).toMatchObject({
    title: 'Lucerna', path: 'projects/lucerna', genre: 'wiki',
  });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'dock-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'dock owner intro.', title: 'Dock Intro',
  });
  // Lucerna —— 让 mock 在小 chat 里也能走 corpus_search → cite(镜像大 chat 全流程)。
  // 标 indexed 让 /wiki/projects/lucerna landing 能渲(位置感知 plumbing 测试用)。
  const luc = await seedWiki(request, apiToken, sid, {
    body: 'lucerna is a local-first knowledge tool.',
    title: 'Lucerna', path: 'projects/lucerna',
  });
  await callTool(request, apiToken, sid, 'seo.set_wiki_seo', {
    wiki_id: luc.wikiID, seo_description: 'a local-first knowledge tool', seo_indexed: true,
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Dock test',
  });
  await request.dispose();
}
