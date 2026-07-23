// dock-buttons-visitor.spec.ts —— #109/#110 E：访客侧的 dock 按钮渲染 + 点击。
//
// 按钮 = 快捷方式：点它 = 把 owner 配的「触发词」当访客消息发出去 → 走正常 agent turn。
// 按钮 label = 能力的 MCP title。这里只验按钮的职责（渲染 + 点击发出触发词 + turn 触发）；
// 能力答得对不对由各自能力的测试（summarize/booking）保证 —— 关注点分离。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'dock-visitor@example.com', password: 'correct-horse-battery-staple',
  handle: 'dockvisitor', fullName: 'Dock Visitor Owner',
};
const CODE = 'DOCKV-1';
const LATE_CODE = 'DOCKV-LATE';
const CAP_SUMMARIZE = 'summarize_conversation';
const CAP_RETRIEVAL = 'corpus.retrieval';
const TRIGGER_SUMMARIZE = 'Summarize our conversation so far';
const TRIGGER_RETRIEVAL = 'What have we covered?';
let lateRoleID = '';

// bindSummarizeDock —— add a summarize dock button to the late role via the admin API (owner binds
// it while a visitor is mid-session). Module-scope so the describe callback stays within its line cap.
async function bindSummarizeDock(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.put(`${BACKEND}/api/admin/roles/${lateRoleID}`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'dockv-late', description: 'wiki', greeting: '', prompt_id: null,
      corpus_uris: ['wiki://**'], skill_ids: [], mcp_server_ids: [], waypoints: [],
      dock_buttons: [{ capability_id: CAP_SUMMARIZE, trigger: TRIGGER_SUMMARIZE }],
    },
  });
  expect(res.status(), 'bind dock via admin PUT').toBe(200);
}

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
    // F-A-20: a role that starts DOCKLESS; the test binds a dock button mid-session and switches
    // name in-page to prove the re-issue picks it up without a reload.
    const lateRole = await createRole(request, csrf, {
      name: 'dockv-late', description: 'wiki', corpus_uris: ['wiki://**'],
    });
    lateRoleID = lateRole.id;
    await createCode(request, csrf, { code: LATE_CODE, label: 'dockv-late', assumed_role_id: lateRole.id });
    const token = await createAPIToken(request, csrf, 'dockv-seed');
    const sid = await initMCP(request, token);
    await seedWiki(request, token, sid, {
      title: 'Current Work', body: 'I am building a notification pipeline.',
      path: 'current-work',
    });
    await request.dispose();
  });

  async function enterChat(page: Page, code = CODE, name = 'Sam'): Promise<void> {
    await goto(page, '/gate');
    await page.getByTestId('gate-code').fill(code);
    await page.getByTestId('gate-visitor-name').fill(name);
    await page.getByTestId('gate-code-submit').click();
    await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 8_000 });
  }

  // E4 (F-A-20): binding a dock button mid-session, then switching name IN-PAGE (the picker re-issues
  // the session — no navigation), must render the dock WITHOUT a reload. RED before the fix: the
  // in-page re-issue seeded only ghosts, so the new session's dock stayed empty until a reload.
  test('E4 switching name in-page picks up a freshly-bound dock without a reload (F-A-20)',
    async ({ page, playwright }) => {
      await enterChat(page, LATE_CODE, 'Sam');
      // dockless role → no dock yet.
      await expect(page.getByTestId('dock-buttons')).toBeHidden({ timeout: 5_000 });
      // owner binds a summarize dock button now.
      const request = await playwright.request.newContext();
      await bindSummarizeDock(request);
      await request.dispose();
      // switch name IN-PAGE (no reload) → the picker re-issues the session.
      await page.getByTestId('session-strip-switch-name').click();
      await page.getByTestId('visitor-name-input').fill('Robin');
      await page.getByTestId('visitor-name-submit').click();
      await expect(page.getByTestId('session-strip')).toContainText('Robin', { timeout: 8_000 });
      // the dock must render WITHOUT a reload.
      await expect(page.getByTestId('dock-buttons')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId(`dock-button-${CAP_SUMMARIZE}`)).toBeVisible();
    });

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
