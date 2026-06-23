// visitor-ask-visitor.spec.ts —— ask_visitor 已外置成独立 MCP app（in-process 加载），
// 它的 widget 现在是 server 自带的 ui:// 卡，渲在**沙盒 iframe** 里（McpAppCard）。
//
// 用户故事不变，渲染机制变了：
//   1. visitor 持 code 进 chat
//   2. AI (mock) 调 ask_visitor (kind=radio, 3 options)
//   3. McpAppCard 渲一个 sandbox iframe（data-testid=mcp-app-card-ask_visitor），
//      卡 HTML 来自 ask-visitor server 的 ui:// 资源；question/options 由父页经
//      postMessage 注入，渲在 iframe 内
//   4. visitor 在 iframe 里点 option → 卡 postMessage('mcp-ui:submit') → 下一 turn
//      自动 ask(选中项)，卡 lock 住 (data-answered=true)
//
// 断言用 frameLocator 钻进沙盒 iframe。yes_no / multi 各一条覆盖。

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall, scriptTag } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'ask-visitor-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'askowner',
  fullName: 'Ask Visitor Owner',
};

const CODE = 'ASKV-001';

const RADIO_OPTIONS = ['Recruiter', 'Engineering peer', 'Friend'];

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor ask_visitor capability · externalized sandbox card', () => {
  test('radio widget renders in sandbox → click option → next turn + card locks',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'ask_visitor',
        key: 'askv-radio',
        args: {
          question: 'Which best describes you?',
          kind: 'radio',
          options: RADIO_OPTIONS,
        },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'hello', 'askv-radio');
      const frame = await assertRadioCard(page, 'Which best describes you?');
      await frame.getByTestId('ask-visitor-opt-1').click();
      await expect(frame.locator('[data-testid="ask-visitor-card"]'))
        .toHaveAttribute('data-answered', 'true', { timeout: 5_000 });
      await expect(lastDialog(page)).toContainText('Engineering peer', { timeout: 5_000 });
    });

  test('yes_no widget renders Yes / No buttons in sandbox',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'ask_visitor',
        key: 'askv-yesno',
        args: { question: 'Want me to focus on details?', kind: 'yes_no' },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'tell me about the project', 'askv-yesno');
      await expect(page.getByTestId('mcp-app-card-ask_visitor'))
        .toBeVisible({ timeout: 10_000 });
      const frame = askFrame(page);
      await expect(frame.locator('[data-testid="ask-visitor-card"]'))
        .toHaveAttribute('data-kind', 'yes_no', { timeout: 10_000 });
      await expect(frame.getByTestId('ask-visitor-opt-yes')).toBeVisible();
      await expect(frame.getByTestId('ask-visitor-opt-no')).toBeVisible();
    });

  test('multi widget collects picks → submit posts joined selection',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'ask_visitor',
        key: 'askv-multi',
        args: {
          question: 'Which topics?', kind: 'multi',
          options: ['systems', 'design', 'careers'],
        },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'what do you write about', 'askv-multi');
      await expect(page.getByTestId('mcp-app-card-ask_visitor'))
        .toBeVisible({ timeout: 10_000 });
      const frame = askFrame(page);
      await expect(frame.locator('[data-testid="ask-visitor-card"]'))
        .toHaveAttribute('data-kind', 'multi', { timeout: 10_000 });
      await frame.getByTestId('ask-visitor-opt-0').click(); // systems
      await frame.getByTestId('ask-visitor-opt-2').click(); // careers
      await frame.getByTestId('ask-visitor-submit').click();
      const dialogs = page.locator('[data-testid="conversation-deck"] article, [data-testid="chatroom"] article');
      await expect(dialogs.last()).toContainText('systems, careers', { timeout: 5_000 });
    });
});

function askFrame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid="mcp-app-card-ask_visitor"]');
}

function lastDialog(page: Page) {
  return page
    .locator('[data-testid="conversation-deck"] article, [data-testid="chatroom"] article')
    .last();
}

// assertRadioCard —— 等沙盒卡渲出 + 校验 question/options，返回 frame 供点击。
async function assertRadioCard(page: Page, question: string): Promise<FrameLocator> {
  await expect(page.getByTestId('mcp-app-card-ask_visitor'),
    'sandbox iframe rendered').toBeVisible({ timeout: 10_000 });
  const frame = askFrame(page);
  await expect(frame.locator('[data-testid="ask-visitor-card"]'))
    .toHaveAttribute('data-kind', 'radio', { timeout: 10_000 });
  await expect(frame.getByTestId('ask-visitor-question')).toHaveText(question);
  for (let i = 0; i < RADIO_OPTIONS.length; i++) {
    await expect(frame.getByTestId(`ask-visitor-opt-${i}`)).toBeVisible();
  }
  return frame;
}

async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

// fireFirstTurn —— type + send the first visitor turn. scriptKey binds this
// turn to a keyed mock script (scriptTag token) so a trailing turn from a
// sibling test can't steal it.
async function fireFirstTurn(page: Page, q: string, scriptKey?: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(scriptKey ? `${q}${scriptTag(scriptKey)}` : q);
  await input.press('Enter');
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
    name: 'ask-role', description: 'ask visitor spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'ask', assumed_role_id: role.id,
  });
  await request.dispose();
}
