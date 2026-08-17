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

interface SkillCreateResp { id: string; name: string }

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

    // **载荷默认不摊在访客脸上**(F-D-10)。这张卡的注释写着它是「debug-grade dump，让 *owner*
    // 观察 visitor 这边跑了啥」—— 可它渲染在**访客**的 transcript 里。prod 上真拍到的样子是
    // 一大块等宽 JSON，`\n` 字面量和开头那个引号都在。
    // 这条断言以前**逐字要求那份原文可见**（`toContainText(BODY_MARKER)`），
    // 又一次「守卫记录的是缺陷本身」（[[parked-test-carries-a-wrong-diagnosis]]）。
    // 判据换成：**默认收起**（owner 展开还看得到，访客不用先越过它）。
    // 断在**卡里面**那一份:mock LLM 会把工具结果回声进答案正文,页面上因此有两处带这个标记,
    // 而这条守的是卡（[[stand-in-is-politer-than-reality]] 的反面 —— 替身在这里比真实世界更吵）。
    await expect(
      card.getByText(BODY_MARKER),
      '技能正文默认不该摊开在访客的逐字稿里',
    ).toBeHidden();
    // owner 要的那份没丢：展开就在。
    await card.locator('summary').click();
    await expect(card.getByText(BODY_MARKER)).toBeVisible({ timeout: 5_000 });
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
      skill_ids: [skill.id], mcp_server_ids: [],
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
