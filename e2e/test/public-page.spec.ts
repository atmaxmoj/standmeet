// public-page.spec.ts —— 访客的 end-to-end 用户流程。
//
// 用户故事：
//   一个陌生访客打开 owner 的 StandMeet 公开页，应当读到 owner 的 hero
//   prose、看到 insights / projects / where / contact 全部 section，
//   然后能在 chat dock 输入问题、按 Enter，收到 AI 流式回复（mock
//   provider 注入的固定文本），最后看到回复底部标注引用了多少条 corpus
//   entry。整套流程都通过浏览器 + 真实 stack 验证；setup（owner 建账号、
//   seed 一条公开 wiki）通过 helper 走 admin/MCP，但访客本身的体验只走 UI。

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login } from '../helper/admin';
import { seedPublicWiki } from '../helper/corpus';
import { resetInstance, findSetupToken } from '../helper/docker';
import { initMCP } from '../helper/mcp';
import { navigateToHandle } from '../helper/navigate';

const OWNER_HANDLE = 'sijie';
const MOCK_REPLY = 'Hello visitor, sijie says hi from the mock provider.';

test.describe.serial("visitor reads owner's public page and chats with the persona", () => {
  test.beforeAll(() => {
    resetInstance();
  });

  test('visitor sees full page, asks a question, gets a streamed grounded reply',
    async ({ page, request }) => {
      await seedOwnerWithPublicCorpus(request);
      await navigateToHandle(page, OWNER_HANDLE);

      await expectOwnerPageRendered(page);
      await visitorAsksAQuestion(page, 'tell me about sijie');
      await expectAssistantStreamsReply(page);
      await expectCitationFootnote(page);
    });
});

// seedOwnerWithPublicCorpus —— 真实站点的前置条件：instance 被 claim、
// owner 通过 MCP 写过一条 public wiki。访客的 chat 才有"corpus 可引用"。
// 整段都不属于"访客 UI 流程"，所以走 helper 不走浏览器。
async function seedOwnerWithPublicCorpus(request: APIRequestContext): Promise<void> {
  await claim(request, findSetupToken());
  const { csrf } = await login(request);
  const apiToken = await createAPIToken(request, csrf);
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'sijie loves ASCII sparklines.',
    title: 'Sijie intro',
    tags: ['intro'],
  });
}

async function expectOwnerPageRendered(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Sijie Wang' })).toBeVisible();
  await expect(page.getByText('insights', { exact: true })).toBeVisible();
  await expect(page.getByText('projects', { exact: true })).toBeVisible();
  await expect(page.getByText('where I am', { exact: true })).toBeVisible();
  await expect(page.getByText('how to talk to me', { exact: true })).toBeVisible();
  await expect(page.getByText('What do you think about AI replacing engineers?'))
    .toBeVisible();
  await expect(page.getByText("AI coding doesn't make engineers faster", { exact: false }))
    .toBeVisible();
  await expect(page.getByText('Lucerna').first()).toBeVisible();
}

async function visitorAsksAQuestion(page: Page, question: string): Promise<void> {
  const input = page.locator('[data-testid="chat-input"] textarea');
  await input.fill(question);
  await input.press('Enter');
}

async function expectAssistantStreamsReply(page: Page): Promise<void> {
  await expect(page.getByText('reply', { exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(MOCK_REPLY, { exact: false }))
    .toBeVisible({ timeout: 15_000 });
}

async function expectCitationFootnote(page: Page): Promise<void> {
  const cited = page.locator('[data-testid="cited"]');
  await expect(cited).toBeVisible({ timeout: 5_000 });
  await expect(cited).toContainText('grounded in');
}
