// visitor-chat-ghost.spec.ts —— H.13.d / H.13.e: code-accessor ghost
// text autofill + admin 后台日志观测。
//
// 用户故事：
//   1. owner 建 code 时填 ghosts
//   2. visitor 持 code 进 chat → 输入框 placeholder = 第一条 ghost
//   3. visitor 按 Tab → input.value = 第一条 (autofill, 不 auto-send)
//   4. visitor 清空 → 按 Escape → ghost cycle 到第二条
//   5. H.13.e: backend 落 shown row；Tab 触发 accept → admin transcript
//      modal 渲一条 "ghost text shown" 日志、accepted=true
//
// Backend SSE `ghosts` 帧 (follow-up) 的追加路径走单独 endpoint
// spec 验证 (agent-turn-endpoint.spec.ts assertGhostsFrame)。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection, enterCodeSession } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { issueSession } from '@/fixtures/visitor';

const OWNER = {
  email: 'ghost-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghostowner',
  fullName: 'Ghost Owner',
};

const CODE = 'GHOST-001';

// GHOSTS —— owner 在建码时填的初始 ghost 队列。前端按 [0] 渲；按
// Escape cycle 到 [1]。
const GHOSTS = [
  'What did you ship last quarter?',
  'Why are you considering a move?',
  'What does the team look like?',
];

// 整文件共用 OWNER 凭据；test.use 在 file scope，所有 describe 拿到的
// adminPage fixture 都登 ghost-owner。test.beforeAll 单实例化也在 file
// scope，跨 describe 共享 (Playwright 文档语义：file-level beforeAll 在
// 第一个 test 前跑一次)。
test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('visitor chat ghost text · H.13.d', () => {
  test('code visitor → input placeholder = ghost[0]; Tab fills input',
    async ({ page }) => {
      await enterChatWithCode(page);
      const input = page.getByTestId('chat-input-field');
      await expect(input, 'ghost = suggested[0]')
        .toHaveAttribute('data-ghost', GHOSTS[0]!, { timeout: 5_000 });
      await expect(input, 'placeholder mirrors ghost')
        .toHaveAttribute('placeholder', GHOSTS[0]!);
      await input.focus();
      await input.press('Tab');
      await expect(input, 'Tab 把 ghost 填进 input (不 submit)')
        .toHaveValue(GHOSTS[0]!);
    });

  test('Escape cycle 到下一条 ghost (input 已空)',
    async ({ page }) => {
      await enterChatWithCode(page);
      const input = page.getByTestId('chat-input-field');
      await expect(input).toHaveAttribute('data-ghost', GHOSTS[0]!, { timeout: 5_000 });
      await input.focus();
      await input.press('Escape');
      await expect(input, 'cycle 后 ghost = suggested[1]')
        .toHaveAttribute('data-ghost', GHOSTS[1]!);
      await expect(input, 'placeholder 跟着切')
        .toHaveAttribute('placeholder', GHOSTS[1]!);
    });

  // 原始 bug:答完一轮后 backend emit 新的 followup ghost,但前端 append 不推进
  // index → 输入框一直卡在 seed[0]。修后:答完 ghost 推进到 AI 的 followup。
  test('答完后 ghost 推进到 AI followup(不再卡在 seed[0])',
    async ({ page }) => {
      await enterChatWithCode(page);
      const input = page.getByTestId('chat-input-field');
      await expect(input).toHaveAttribute('data-ghost', GHOSTS[0]!, { timeout: 5_000 });

      await input.fill('what have you been up to lately');
      await input.press('Enter');
      await expect(page.getByTestId('answer-body')).toBeVisible({ timeout: 20_000 });

      // followup 来自 mock followupGhosts[0];ghost 应推进到它,不再是 seed[0]。
      await expect(input, '答完 ghost 推进到 followup,不卡 seed[0]')
        .toHaveAttribute('data-ghost', 'What got you into this work?', { timeout: 10_000 });
    });
});

// H.13.e admin observability —— admin 走 UI (打开 transcript modal 看日
// 志)；visitor 走 API (直接 POST shown / accept)，避免单 Page 上下文里
// visitor + admin 互相挤掉。visitor UI 已在上面 H.13.d test 覆盖。
test.describe('visitor chat ghost text · admin 观测 · H.13.e', () => {
  test('shown + accept → admin transcript modal 渲 ghost 日志 + accepted',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      await seedShownAndAccept(request);
      await request.dispose();

      await openConversationModalInAdmin(adminPage);
      const logBlock = adminPage.getByTestId('transcript-ghosts');
      await expect(logBlock, 'admin 见 ghost text shown 块').toBeVisible({ timeout: 5_000 });
      const rows = logBlock.getByTestId('transcript-ghost-row');
      await expect(rows, '至少一行').toHaveCount(1, { timeout: 5_000 });
      await expect(rows.first(), 'source = initial')
        .toHaveAttribute('data-source', 'initial');
      await expect(rows.first(), 'Tab 被 accept = true')
        .toHaveAttribute('data-accepted', 'true');
    });
});

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

async function seedShownAndAccept(request: APIRequestContext): Promise<void> {
  const sess = await issueSession(request, {
    handle: OWNER.handle, code: CODE, visitor_name: 'V',
  });
  const shown = await postShown(request, sess);
  await postAccept(request, sess, shown.id);
}

async function postShown(
  request: APIRequestContext,
  sess: { session_token: string; conversation_id: string },
): Promise<{ id: string }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/ghosts/shown`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: { ghost_text: GHOSTS[0]!, source: 'initial', turn_index: 0 },
    },
  );
  expect(res.status()).toBe(200);
  return await res.json() as { id: string };
}

async function postAccept(
  request: APIRequestContext,
  sess: { session_token: string; conversation_id: string },
  id: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/ghosts/${id}/accept`,
    { headers: { Authorization: `Bearer ${sess.session_token}` } },
  );
  expect(res.status()).toBe(204);
}

async function openConversationModalInAdmin(adminPage: Page): Promise<void> {
  await gotoAdminSection(adminPage, 'conversations');
  // conv-table 第一行 = 刚才 visitor 那段 conversation。
  const firstRow = adminPage.getByTestId('conv-table').locator('tbody tr').first();
  await firstRow.click();
  await expect(adminPage.getByTestId('transcript-body')).toBeVisible({ timeout: 5_000 });
}

// enterCodeSession 已 skip 名字选择器并等到 /sessions 200;不二次 dismiss
// (会采样到 picker unmount 窗口 → click 10s 超时,check-then-act race)。
async function enterChatWithCode(page: Page): Promise<void> {
  await enterCodeSession(page, CODE);
  // code-mode visitor 落到 ChatRoom (page-shell.useChatModeDetect)；
  // chat-input form 渲在 sticky composer 里。
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
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
    name: 'ghost-role', description: 'ghost spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'ghost', assumed_role_id: role.id,
    ghosts: GHOSTS,
  });
  await request.dispose();
}
