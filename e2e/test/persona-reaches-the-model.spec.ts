// persona-reaches-the-model.spec.ts —— F-A-36。owner 为这个受众写的**人格**、这张码自己的
// prompt、以及每条 skill 的名字，必须真的出现在送给模型的 system prompt 里。
//
// 后端这一侧一直是对的：role 的 persona 正文 + code prompt(#104) + 每条 skill 的 L1 行由
// `ComposeDynamicPersona` 拼成一段，随 /sessions 响应下发（`system_prompt_persona`）。
// 浏览器把它存进 `PageSession.persona` —— 一个有类型、有持久化、有 restore 的字段 ——
// **然后全仓没有任何一处读它**。这一轮的 system prompt 由 `composeSystemPrompt()` 拼，
// 而它只遍历 `systemPromptPartIDs`（visitor-header + 每个 capability 一段，没有 persona 那段）；
// 后端也不会补，`agent_loop.go` 的 Instruction 直接用浏览器发来的 `req.System`。
//
// 三样东西因此从没到过模型手上：① owner 配的人格 ② 每张码自己的 prompt ③ skill 的名字。
// 第三样让 `skill_use` 永远点不出名字（它的入参是准确的 skill 名），整条 skill/沙箱脚本的路
// 对访客不可达 —— sandbox 模块驱不动就是这个原因。第一样多半也是 UX-66 的成因。
//
// **判据在访客真看得见的那段文字上**：mock 网关把收到的 system prompt 原样回显成
// `[system:…]`（现有验 prompt 装配的 spec 走的都是这条），所以断言直接读渲染出来的回答。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'persona@example.com',
  password: 'persona-reaches-pass-1',
  handle: 'personaowner',
  fullName: 'Persona Owner',
};

const CODE = 'PERSONA-01';
// 一句只可能来自 role persona 的话 —— 语料里没有，header 里也没有。
const PERSONA_MARK = 'ALWAYS-OPEN-WITH-THE-LEDGER';
const ROLE = 'persona-carrier';

test.describe('F-A-36 · the persona the owner wrote reaches the model', () => {
  let roleID = '';

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance 在负载高时要 ~48s，而钩子默认只给 30s
    roleID = await initOwner(playwright);
    expect(roleID, 'the role carrying the persona exists').not.toBe('');
  });

  test('the role persona is in the system prompt the model actually receives',
    async ({ page, playwright }) => {
      const request = await playwright.request.newContext();
      const tag = await scriptMockReplyText(request, 'noted.');
      await enterCodeSession(page, CODE, 'Reader');
      await page.getByTestId('chat-input-field').fill(`hello ${tag}`);
      await page.getByTestId('chat-input-field').press('Enter');

      // mock 把收到的 system prompt 原样回显进回答里，所以这句话出现 = 它真的送到了。
      await expect(page.getByText(PERSONA_MARK, { exact: false }),
        'the persona the owner wrote for this role is in the prompt the model got')
        .toBeVisible({ timeout: 20_000 });
      await request.dispose();
    });
});

async function initOwner(playwright: Playwright): Promise<string> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'persona-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'persona intro.', title: 'Persona Intro',
  });
  const id = await createRoleWithPersona(request, csrf);
  await createCode(request, csrf, { code: CODE, label: 'Persona', assumed_role_id: id });
  await request.dispose();
  return id;
}

// createRoleWithPersona —— 一个带 prompt 正文的 role。persona 走 prompts 库挂到 role 上，
// 跟 owner 在 /admin/prompts + /admin/roles 上做的是同一件事。
async function createRoleWithPersona(
  request: APIRequestContext, csrf: string,
): Promise<string> {
  const backend = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
  const p = await request.post(`${backend}/api/admin/prompts`, {
    headers: { 'X-Csrftoken': csrf },
    data: { name: 'persona-body', body: `${PERSONA_MARK}. Speak plainly and cite the ledger.` },
  });
  if (!p.ok()) throw new Error(`create prompt failed: ${p.status()}`);
  const prompt = await p.json() as { id: string };
  const r = await request.post(`${backend}/api/admin/roles`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: ROLE, description: 'carries a persona', greeting: '',
      prompt_id: prompt.id, corpus_uris: ['wiki://**'],
      skill_ids: [], mcp_server_ids: [], dock_buttons: [], waypoints: [],
    },
  });
  if (!r.ok()) throw new Error(`create role failed: ${r.status()}`);
  const role = await r.json() as { id: string };
  return role.id;
}
