// public-page.spec.ts —— 访客的 end-to-end 用户流程。
//
// 用户故事：
//   一个陌生访客打开 owner 的 StandMeet 公开页，应当读到 owner 的 hero
//   prose、看到 insights / projects / where / contact 全部 section，
//   然后能在 chat dock 输入问题、按 Enter，收到 AI 流式回复（mock
//   provider 注入的固定文本），最后看到回复底部标注引用了多少条 corpus
//   entry。
//
// e2e 零 goto：claim + seed wiki 在 beforeAll 走 API；page fixture 自动
// goto('/') 之后 instance 已 claimed → 渲染公开页（不会 redirect 到 /setup）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login } from '@/fixtures/admin';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const MOCK_REPLY = 'Hello visitor, alice says hi from the mock provider.';

test.describe("visitor reads owner's public page and chats with the persona", () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken());
    const { csrf } = await login(request);
    const apiToken = await createAPIToken(request, csrf);
    const sid = await initMCP(request, apiToken);
    await seedPublicWiki(request, apiToken, sid, {
      body: 'alice loves ASCII sparklines.',
      title: 'Alice intro',
      tags: ['intro'],
    });
    await request.dispose();
  });

  test('visitor sees full page, asks a question, gets a streamed grounded reply',
    async ({ page }) => {
      await expectOwnerPageRendered(page);
      await visitorAsksAQuestion(page, 'tell me about alice');
      await expectAssistantStreamsReply(page);
      await expectCitationFootnote(page);
    });
});

async function expectOwnerPageRendered(page: Page): Promise<void> {
  // 设计稿里 owner 全名摆 identity strip 里（mono caps span 不是 heading），
  // 所以走 getByText 而不是 getByRole('heading')。
  await expect(page.getByText('Alice Anderson')).toBeVisible();
  await expect(page.getByText("things I've been thinking about")).toBeVisible();
  await expect(page.getByText("what I'm building")).toBeVisible();
  await expect(page.getByText('where I am', { exact: true })).toBeVisible();
  await expect(page.getByText('how to talk to me', { exact: true })).toBeVisible();
  await expect(page.getByText('What do you think about AI replacing engineers?'))
    .toBeVisible();
  await expect(page.getByText("AI coding doesn't make engineers faster", { exact: false }))
    .toBeVisible();
  await expect(page.getByText('Lucerna').first()).toBeVisible();
}

async function visitorAsksAQuestion(page: Page, question: string): Promise<void> {
  // 新 AskInput 是 input[type=text]，不是 textarea；form submit on Enter。
  const input = page.locator('[data-testid="chat-input"] input');
  await input.fill(question);
  await input.press('Enter');
}

async function expectAssistantStreamsReply(page: Page): Promise<void> {
  // ConversationDeck 把回复挂在 data-testid="answer-body" 里；mock 文本会
  // 流到那里。
  await expect(page.locator('[data-testid="answer-body"]'))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(MOCK_REPLY, { exact: false }))
    .toBeVisible({ timeout: 15_000 });
}

async function expectCitationFootnote(page: Page): Promise<void> {
  // 引用块从 "grounded in N entries" 升级成 list with titles —— assistant
  // 回复下方的 "drawn from" + 每条 cited corpus 的 kind 标签 + 标题。
  const cited = page.locator('[data-testid="citations"]');
  await expect(cited).toBeVisible({ timeout: 5_000 });
  await expect(cited).toContainText('drawn from');
}
