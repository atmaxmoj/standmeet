// dock-buttons-visitor.spec.ts —— #109/#110 E：访客侧的 dock 按钮渲染 + 点击。
//
// 按钮 = 快捷方式：点它 = 把 owner 配的「触发词」当访客消息发出去 → 走正常 agent turn。
// 按钮 label = 能力的 MCP title。这里只验按钮的职责（渲染 + 点击发出触发词 + turn 触发）；
// 能力答得对不对由各自能力的测试（summarize/booking）保证 —— 关注点分离。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'dock-visitor@example.com', password: 'correct-horse-battery-staple',
  handle: 'dockvisitor', fullName: 'Dock Visitor Owner',
};
const CODE = 'DOCKV-1';
const CAP_SUMMARIZE = 'summarize_conversation';
const CAP_RETRIEVAL = 'corpus.retrieval';
const TRIGGER_SUMMARIZE = 'Summarize our conversation so far';
const TRIGGER_RETRIEVAL = 'What have we covered?';

test.describe('dock buttons · E — visitor render + click', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const role = await createRole(request, csrf, {
      name: 'dockv', description: 'wiki', corpus_uris: ['wiki://**'],
      dock_buttons: [
        { capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE },
        { capability_id: CAP_RETRIEVAL, trigger: TRIGGER_RETRIEVAL },
      ],
    });
    await createCode(request, csrf, { code: CODE, label: 'dockv', assumed_role_id: role.id });
    const token = await createAPIToken(request, csrf, 'dockv-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      title: 'Current Work', body: 'I am building a notification pipeline.',
      path: 'current-work',
    });
    await request.dispose();
  });

  async function enterChat(page: Page): Promise<void> {
    await goto(page, '/gate');
    await page.getByTestId('gate-code').fill(CODE);
    await page.getByTestId('gate-visitor-name').fill('Sam');
    await page.getByTestId('gate-code-submit').click();
    await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 8_000 });
  }

  test('E1/E3 exactly the ≤2 configured buttons render, labelled by the MCP title (not the id)',
    async ({ page }) => {
      await enterChat(page);
      const bar = page.getByTestId('dock-buttons');
      await expect(bar).toBeVisible({ timeout: 5_000 });
      await expect(bar.getByTestId(/^dock-button-/)).toHaveCount(2);
      const summ = page.getByTestId(`dock-button-${CAP_SUMMARIZE}`);
      await expect(summ).toBeVisible();
      // label 是 title，不是能力 id。
      await expect(summ).not.toHaveText(CAP_SUMMARIZE);
      await expect(summ).not.toHaveText('');
    });

  test('E2 clicking a dock button sends its trigger as a visitor message → agent turn fires',
    async ({ page }) => {
      await enterChat(page);
      await page.getByTestId(`dock-button-${CAP_SUMMARIZE}`).click();
      // 触发词作为访客消息进 transcript（= 跟打字一样）。
      await expect(page.getByText(TRIGGER_SUMMARIZE)).toBeVisible({ timeout: 8_000 });
      // agent turn 触发并出答案。
      await expect(page.locator('[data-testid="answer-body"]')).toBeVisible({ timeout: 20_000 });
    });
});
