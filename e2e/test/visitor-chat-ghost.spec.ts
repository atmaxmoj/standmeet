// visitor-chat-ghost.spec.ts —— Ghost steering P4: 输入框**单个** ghost-text(单-candidate,替换旧的
// 多队列 + Esc cycle + 每轮 3 条 followup)。
//
// 单-ghost 设计([[ghost-steering]] "one ghost beats three"):
//   1. code visitor 进 chat → 输入框显示**一条** ghost(initial = code.ghosts 首条)
//   2. Tab → 填进 input(不 auto-send)
//   3. Esc **不再 cycle**(没有第二条可切;单个)
//   4. 答完一轮 → policy 发**单数** `ghost` 帧 → 输入框 ghost 换成 policy 那条(target_waypoint 引导)
//   5. admin transcript modal 见 shown 日志,source ∈ {initial, policy},accepted 随 Tab
//
// RED(实现前):store 仍是多队列 + cycle,后端仍发旧 `ghosts` 帧(3 条) → 单个断言红。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockGhost } from '@/fixtures/mock-llm-script';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'ghost-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghostowner',
  fullName: 'Ghost Owner',
};
const CODE = 'GHOST-001';

// code.ghosts 静态启动语保留(QR/landing 的 suggested questions),但输入框 ghost-text **只取首条**
// 当单个 initial ghost —— 不再整队列 seed、不 cycle。
const GHOSTS = [
  'What did you ship last quarter?',
  'Why are you considering a move?',
];
const INITIAL = GHOSTS[0]!;

const WP = {
  waypoint_id: 'grasp-alpha', description: 'understand Alpha',
  weight: 5, evidence_refs: ['wiki://alpha'], is_terminal: false,
};
const POLICY_GHOST = {
  text: 'What made you take on Alpha?',
  target_waypoint: 'grasp-alpha',
  follows_from: 'you mentioned Alpha',
  is_bridge: false,
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor chat ghost text · 单个 · P4', () => {
  test('code visitor → 输入框显示单条 ghost(initial);Tab 填进 input', async ({ page }) => {
    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input, 'ghost = code.ghosts 首条(单个 initial)')
      .toHaveAttribute('data-ghost', INITIAL, { timeout: 5_000 });
    await input.focus();
    await input.press('Tab');
    await expect(input, 'Tab 填进 input(不 submit)').toHaveValue(INITIAL);
  });

  test('Esc 不再 cycle(单个,没有第二条可切)', async ({ page }) => {
    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input).toHaveAttribute('data-ghost', INITIAL, { timeout: 5_000 });
    await input.focus();
    await input.press('Escape');
    // 单个:Esc 后 ghost 不该变成 GHOSTS[1](旧行为是 cycle 到第二条)。
    await expect(input, 'Esc 后仍是首条(无 cycle)').not.toHaveAttribute('data-ghost', GHOSTS[1]!);
  });

  test('答完一轮 → 输入框 ghost 换成 policy 单条(不是 3 条 followup)', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    await scriptMockGhost(req, POLICY_GHOST);
    await req.dispose();

    await enterChatWithCode(page);
    const input = page.getByTestId('chat-input-field');
    await expect(input).toHaveAttribute('data-ghost', INITIAL, { timeout: 5_000 });
    await input.fill('tell me about your work');
    await input.press('Enter');
    await expect(page.getByTestId('answer-body')).toBeVisible({ timeout: 20_000 });

    await expect(input, '答完 → policy ghost(单数,target_waypoint 引导)')
      .toHaveAttribute('data-ghost', POLICY_GHOST.text, { timeout: 10_000 });
  });
});

async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'ghost-role', description: 'ghost spec',
    corpus_uris: ['wiki://**', 'output://**'], waypoints: [WP],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'ghost', assumed_role_id: role.id, ghosts: GHOSTS,
  });
  await request.dispose();
}
