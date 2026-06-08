// visitor-ask-visitor.spec.ts —— I.1: code-accessor 进 chat 问句意图不明
// AI 调 ask_visitor → 浏览器渲对应 widget → visitor 点 option → 选中项
// 作为下一 turn 投出去 + 老卡 lock 住显已选。
//
// 用户故事:
//   1. visitor 持 code 进 chat
//   2. AI (mock) 决定调 ask_visitor (kind=radio, 3 options)
//   3. ConversationDeck 渲一张 AskVisitorCard，3 个 button 可点
//   4. visitor 点 option[1] → 下一 turn 自动 ask(option[1])，老卡 lock
//
// yes_no / multi widget 由额外两条 test 覆盖 (button 数 / 多选 submit 流)。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
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

test.describe('visitor ask_visitor capability · I.1', () => {
  test('radio widget renders → click option → next turn carries selection + card locks',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'ask_visitor',
        args: {
          question: 'Which best describes you?',
          kind: 'radio',
          options: RADIO_OPTIONS,
        },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'hello');
      const card = page.getByTestId('tool-card-ask_visitor');
      await expect(card, 'AskVisitorCard rendered').toBeVisible({ timeout: 10_000 });
      await expect(card).toHaveAttribute('data-kind', 'radio');
      await expect(card.getByTestId('ask-visitor-question'))
        .toHaveText('Which best describes you?');
      // 3 个 option 都得有
      for (let i = 0; i < RADIO_OPTIONS.length; i++) {
        await expect(card.getByTestId(`ask-visitor-opt-${i}`)).toBeVisible();
      }
      // Click option[1] = 'Engineering peer'
      await card.getByTestId('ask-visitor-opt-1').click();
      // Card 锁住 (data-answered=true)
      await expect(card).toHaveAttribute('data-answered', 'true', { timeout: 5_000 });
      // 新 dialog 出现，visitor q = 'Engineering peer'
      const dialogs = page.locator('[data-testid="conversation-deck"] article, [data-testid="chatroom"] article');
      await expect(dialogs.last()).toContainText('Engineering peer', { timeout: 5_000 });
    });

  test('yes_no widget renders Yes / No buttons',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'ask_visitor',
        args: { question: 'Want me to focus on details?', kind: 'yes_no' },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'tell me about the project');
      const card = page.getByTestId('tool-card-ask_visitor');
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card).toHaveAttribute('data-kind', 'yes_no');
      await expect(card.getByTestId('ask-visitor-opt-yes')).toBeVisible();
      await expect(card.getByTestId('ask-visitor-opt-no')).toBeVisible();
    });

  test('multi widget collects picks → submit posts joined selection',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      await scriptMockToolCall(request, {
        name: 'ask_visitor',
        args: {
          question: 'Which topics?', kind: 'multi',
          options: ['systems', 'design', 'careers'],
        },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'what do you write about');
      const card = page.getByTestId('tool-card-ask_visitor');
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card).toHaveAttribute('data-kind', 'multi');
      await card.getByTestId('ask-visitor-opt-0').click(); // systems
      await card.getByTestId('ask-visitor-opt-2').click(); // careers
      await card.getByTestId('ask-visitor-submit-multi').click();
      const dialogs = page.locator('[data-testid="conversation-deck"] article, [data-testid="chatroom"] article');
      await expect(dialogs.last()).toContainText('systems, careers', { timeout: 5_000 });
    });
});

async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await dismissNamePicker(page);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function dismissNamePicker(page: Page): Promise<void> {
  const skipBtn = page.getByRole('button', { name: /skip/i });
  const visible = await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  visible && await skipBtn.click();
}

async function fireFirstTurn(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
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
