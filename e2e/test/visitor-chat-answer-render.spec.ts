// visitor-chat-answer-render.spec.ts —— G-X: mock provider 流出含
// markdown / katex / mermaid 的 reply → 真 visitor chat 路径
// (PageShell → ConversationDeck → AnswerParas → ChatMarkdown) 渲染对。
//
// 之前 chat-render-* / document-render 系列都走 wiki landing 或者删
// 掉的 /dev/chat-render fixture path；从来没人验过"agent 文本回复带
// markdown" 这条线 (会过 splitParas 把 body 拆成多段、每段 ChatMarkdown
// 分别渲)。这个 spec 把 mock reply 设为含 5 个 markdown feature 的一段
// 体，verify 答案区里每个 feature 都正确渲染。
//
// next_reply scripting endpoint 是 next_tool 的对称扩展 (同 job-board-mock
// 的 single-slot queue 模式)，不是新加 test-only endpoint —— mock
// provider 整个 codepath 已经是 env-gated 的 dev/test 路径。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

// MARKDOWN_REPLY —— 一段含 5 大 feature 的 mock reply。注意每个块要被
// `\n\n` 隔开因为 useChat.splitParas 是按段拆 (mermaid fenced + math
// display 各自一段，避免跨段)。
const MARKDOWN_REPLY = [
  '# Heading',
  '',
  'A paragraph with **bold**, *italic*, and `inline code`.',
  '',
  '| col1 | col2 |',
  '| ---- | ---- |',
  '| a    | b    |',
  '',
  'Inline math: $E = mc^2$',
  '',
  '$$',
  '\\int_0^1 x^2 dx',
  '$$',
  '',
  '```mermaid',
  'graph LR; A-->B',
  '```',
  '',
  '[link](https://example.com)',
].join('\n');

test.describe('visitor chat answer 真路径 ChatMarkdown 渲染', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createAPIToken(request, csrf, 'answer-render-token');
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'answer-render spec',
    });
    await request.dispose();
  });

  test('mock reply 含 markdown/gfm/katex/mermaid → answer-body 全渲染对',
    async ({ browser, request }) => {
      // script mock reply 在 next /inference/stream 时流出
      await scriptMockReplyText(request, MARKDOWN_REPLY);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/?code=${CODE}`);
      await page.waitForResponse((r) =>
        r.url().endsWith('/api/v1/sessions') && r.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('show me everything');
      await input.press('Enter');

      // answer 出现
      const answer = page.locator('[data-testid="answer-body"]').first();
      await expect(answer).toBeVisible({ timeout: 20_000 });

      // 各 markdown feature 都渲染对
      // heading
      await expect(answer.locator('h1')).toContainText('Heading');
      // bold / italic / inline code
      await expect(answer.locator('strong').first()).toContainText('bold');
      await expect(answer.locator('em').first()).toContainText('italic');
      await expect(answer.locator('code').first()).toContainText('inline code');
      // gfm table
      await expect(answer.locator('table th').first()).toContainText('col1');
      await expect(answer.locator('table td').first()).toContainText('a');
      // katex (inline + display)
      await expect(answer.locator('.katex').first()).toBeVisible();
      await expect(answer.locator('.katex-display').first()).toBeVisible();
      // mermaid lazy svg
      await expect(answer.getByTestId('mermaid-svg').locator('svg').first())
        .toBeVisible({ timeout: 10_000 });
      // link
      await expect(answer.locator('a').first())
        .toHaveAttribute('href', 'https://example.com');

      await ctx.close();
    });
});
