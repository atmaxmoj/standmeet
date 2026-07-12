// visitor-chat-dump-card.spec.ts —— GenericDumpCard：skill_* / ext_* 工具结果的兜底
// 卡（debug-grade JSON 框）。这是唯一没有 ui:// 的卡——它**不迁** Phase F，是常驻 fallback
// （第三方 ext 工具 / skill 没有自带卡时的兜底）。之前零测试，这条补上守它：
//   skill_use 调用 → tool-card-skill_use 渲出 + kicker=工具名 + pre 里 JSON 含结果正文。
// 判据走 cardKindFor(skill_*/ext_*) → 'dump' → GenericDumpCard（tool-call-shape.ts）。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, scriptMockReplyText } from '@/fixtures/mock-llm-script';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'dump-owner@example.com', password: 'correct-horse-battery-staple',
  handle: 'dumpowner', fullName: 'Dump Owner',
};
const CODE = 'DUMP-001';
const SKILL = 'patent-review';
const BODY_MARKER = '[DUMP-CARD-BODY]';

interface SkillCreateResp { skill_id: string; name: string }

test.describe('visitor chat · GenericDumpCard (skill_*/ext_* fallback card)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedSkillRoleCode(request);
    await request.dispose();
  });

  test('skill_use result → tool-card-skill_use dump card with name + JSON body', async ({ browser, playwright }) => {
    const request = await playwright.request.newContext();
    const toolTag = await scriptMockToolCall(request, { name: 'skill_use', args: { name: SKILL } });
    const replyTag = await scriptMockReplyText(request, 'rendered in the dump card');
    await request.dispose();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await enterCodeSession(page, CODE);
    await expect(page.getByTestId('chatroom')).toBeVisible({ timeout: 5_000 });

    const input = page.getByTestId('chat-input-field');
    await input.fill(`use the patent-review skill${toolTag}${replyTag}`);
    await input.press('Enter');

    // GenericDumpCard: testid tool-card-<name>, kicker = tool name, <pre> = JSON of result.
    const card = page.getByTestId('tool-card-skill_use');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('skill_use');       // kicker
    await expect(card).toContainText(BODY_MARKER);        // result JSON carries the SKILL.md body
    await ctx.close();
  });
});

async function seedSkillRoleCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'dump-token');
  const sid = await initMCP(request, token);
  const skill = await callTool<SkillCreateResp>(request, token, sid, 'skill_create', {
    name: SKILL,
    description: 'Reviews patents.',
    prompt: `When reviewing, always note ${BODY_MARKER}.`,
  });
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'dump-role', description: 'dump card fixture role',
      prompt_id: null, corpus_uris: ['wiki://**'],
      skill_ids: [skill.skill_id], mcp_server_ids: [],
    },
  });
  if (roleRes.status() !== 201) throw new Error(`create role: ${roleRes.status()}`);
  const role = await roleRes.json() as { id: string };
  const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code: CODE, label: 'dump code', ghosts: [], assumed_role_id: role.id },
  });
  if (codeRes.status() !== 201) throw new Error(`create code: ${codeRes.status()}`);
}
