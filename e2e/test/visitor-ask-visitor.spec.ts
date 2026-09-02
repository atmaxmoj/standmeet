// visitor-ask-visitor.spec.ts — ask_visitor is now externalized into a standalone MCP
// app (loaded in-process); its widget is now a server-provided ui:// card, rendered
// inside a **sandboxed iframe** (McpAppCard).
//
// The user story hasn't changed, but the rendering mechanism has:
//   1. the visitor enters chat holding a code
//   2. the AI (mock) calls ask_visitor (kind=radio, 3 options)
//   3. McpAppCard renders a sandbox iframe (data-testid=mcp-app-card-ask_visitor); the
//      card's HTML comes from the ask-visitor server's ui:// resource; question/options
//      are injected by the parent page via postMessage and rendered inside the iframe
//   4. the visitor clicks an option inside the iframe → the card postMessages
//      ('mcp-ui:submit') → the next turn auto-asks (the selected option), and the card
//      locks (data-answered=true)
//
// Assertions drill into the sandboxed iframe via frameLocator. One case each for
// yes_no / multi.

import { test, expect } from '@/fixtures/test';
import type { FrameLocator, Page, Playwright } from '@playwright/test';

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

test.describe('visitor ask_visitor capability · externalized sandbox card', () => {
  test('radio widget renders in sandbox → click option → next turn + card locks',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockToolCall(request, {
        name: 'ask_visitor',
        args: {
          question: 'Which best describes you?',
          kind: 'radio',
          options: RADIO_OPTIONS,
        },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'hello', tag);
      const frame = await assertRadioCard(page, 'Which best describes you?');
      await frame.getByTestId('ask-visitor-opt-1').click();
      await expect(frame.locator('[data-testid="ask-visitor-card"]'))
        .toHaveAttribute('data-answered', 'true', { timeout: 5_000 });
      await expect(lastDialog(page)).toContainText('Engineering peer', { timeout: 5_000 });
    });

  test('yes_no widget renders Yes / No buttons in sandbox',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockToolCall(request, {
        name: 'ask_visitor',
        args: { question: 'Want me to focus on details?', kind: 'yes_no' },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'tell me about the project', tag);
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
      const tag = await scriptMockToolCall(request, {
        name: 'ask_visitor',
        args: {
          question: 'Which topics?', kind: 'multi',
          options: ['systems', 'design', 'careers'],
        },
      });
      await request.dispose();

      await enterChatWithCode(page);
      await fireFirstTurn(page, 'what do you write about', tag);
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

// assertRadioCard — waits for the sandbox card to render + verifies question/options,
// returning the frame for clicking.
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

// fireFirstTurn —— type + send the first visitor turn, embedding the script tag
// so the mock's Contains-match binds this turn to the scripted tool. The tag is a
// per-test keyword, so a sibling test's turn (different keyword) can't consume it.
async function fireFirstTurn(page: Page, q: string, tag: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(`${q}${tag}`);
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
