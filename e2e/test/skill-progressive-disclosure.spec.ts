// skill-progressive-disclosure.spec.ts —— Phase C / L2（progressive disclosure
// 第二级）：agent 判定相关 → 调 `skill_use({name})` 读回**正文**。正文以标准
// SKILL.md 形式 render（frontmatter name+description + body）—— 这同时验了
// L2 披露 + SKILL.md 序列化。
//
// 业务故事：
//   role 授权了 patent-review（body 含 [SKILL-L2-BODY]），没授权 secret-skill
//   （body 含 [SECRET-BODY]）。visitor 进 chat，AI 调 skill_use：
//     • skill_use(patent-review) → 回包是 SKILL.md（含 name: patent-review +
//       [SKILL-L2-BODY]）→ 经 mock 的 [skill_result:...] echo 进 answer。
//     • skill_use(secret-skill) → role 没授权 → 回错误，**绝不披露** [SECRET-BODY]。
//
// mock 用 scriptMockToolCall 显式驱动（skill_use 需要 name 入参，自然路径喂不了
// 参数 → 必须 script）。echo 机制：skill_ 前缀的 tool_result 被 mock 回显成
// [skill_result:<body>]，所以 answer-body 能断言到披露内容。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'pd-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'pdowner', fullName: 'PD Owner',
};

const CODE = 'PD-001';
const GRANTED_SKILL = 'patent-review';
const UNGRANTED_SKILL = 'secret-skill';
const L2_BODY_MARKER = '[SKILL-L2-BODY]';
const SECRET_BODY_MARKER = '[SECRET-BODY]';

interface SkillCreateResp { skill_id: string; name: string }

test.describe('Phase C · L2 progressive disclosure: skill_use discloses SKILL.md body', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedSkillsRoleCode(request);
    await request.dispose();
  });

  test('L2: skill_use(granted) → answer carries the SKILL.md body (name + L2 marker)',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, { name: 'skill_use', args: { name: GRANTED_SKILL } });
      const replyTag = await scriptMockReplyText(request, 'here is what the skill says');
      await request.dispose();

      const page = await openChat(browser);
      await ask(page, `use the patent-review skill${toolTag}${replyTag}`);
      const answer = page.getByTestId('answer-body');
      // SKILL.md serialization: frontmatter name + the body marker both disclosed.
      await expect(answer).toContainText(L2_BODY_MARKER, { timeout: 20_000 });
      await expect(answer).toContainText(`name: ${GRANTED_SKILL}`);
      await page.context().close();
    });

  test('L2 ACL: skill_use(ungranted) → error, the ungranted body is never disclosed',
    async ({ browser, playwright }) => {
      const request = await playwright.request.newContext();
      const toolTag = await scriptMockToolCall(request, { name: 'skill_use', args: { name: UNGRANTED_SKILL } });
      const replyTag = await scriptMockReplyText(request, 'I could not open that skill');
      await request.dispose();

      const page = await openChat(browser);
      await ask(page, `use the secret skill${toolTag}${replyTag}`);
      const answer = page.getByTestId('answer-body');
      await expect(answer).toContainText('could not open that', { timeout: 20_000 });
      // hard ACL: the ungranted skill's body must never reach the transcript.
      await expect(answer).not.toContainText(SECRET_BODY_MARKER);
      await page.context().close();
    });
});

async function openChat(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });
  return page;
}

async function ask(page: Page, q: string): Promise<void> {
  const input = page.getByTestId('chat-input-field');
  await input.fill(q);
  await input.press('Enter');
}

async function seedSkillsRoleCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'pd-token');
  const sid = await initMCP(request, token);
  const granted = await callTool<SkillCreateResp>(request, token, sid, 'skill_create', {
    name: GRANTED_SKILL,
    description: 'Reviews patents [SKILL-L1-DESC].',
    prompt: `When reviewing, always note ${L2_BODY_MARKER}.`,
  });
  // ungranted skill exists in the owner's library but is NOT attached to the role.
  await callTool<SkillCreateResp>(request, token, sid, 'skill_create', {
    name: UNGRANTED_SKILL,
    description: 'Secret skill not granted to this role.',
    prompt: `Secret instructions ${SECRET_BODY_MARKER}.`,
  });
  await createRoleAndCode(request, csrf, granted.skill_id);
}

async function createRoleAndCode(
  request: APIRequestContext, csrf: string, skillID: string,
): Promise<void> {
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'pd-role', description: 'progressive disclosure fixture role',
      prompt_id: null, corpus_uris: ['wiki://**'],
      skill_ids: [skillID], mcp_server_ids: [],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code: CODE, label: 'PD code', ghosts: [], assumed_role_id: role.id },
  });
  if (codeRes.status() !== 201) {
    throw new Error(`create code: ${codeRes.status()} ${await codeRes.text()}`);
  }
}
