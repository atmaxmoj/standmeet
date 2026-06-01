// skill-scripts.spec.ts —— owner curates a Skill with a sandbox-executed
// script; the script becomes an MCP-style tool the visitor-facing AI can
// call. mock provider exercises it; the chat reply echoes the tool result
// (因为 mock 模式下 backend echo `[skill_result:...]` block 进 reply 让
// e2e 可以 assert)。
//
// 业务故事：
//   alice 在 Claude Desktop 用 skill_create 给自己加一个 "marker-emitter"
//   skill: 一段 bash 脚本 `echo "[SANDBOX-MARKER]"`。把它绑到 INVITE
//   MARKER-001；recruiter 在浏览器里跟 AI 聊，AI 调 skill tool，sandbox
//   docker 隔离运行脚本，stdout=`[SANDBOX-MARKER]`，被打包进 tool_result
//   返给 AI 再传到 chat reply (mock echoes)。
//
// UI-driven (G-1)：visitor 真开浏览器去 /?code=...，看到
// tool-throbber-skill_marker-emitter_run 出现 + chat reply 含 marker。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import type { APIRequestContext } from '@playwright/test';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const CODE = 'MARKER-001';
const SKILL_NAME = 'marker-emitter';
const SCRIPT_FILENAME = 'run.sh';
const MARKER = '[SANDBOX-MARKER]';
const TOOL_THROBBER_TESTID = `tool-throbber-skill_${SKILL_NAME}_run`;

interface SkillCreateResp {
  skill_id: string;
  name: string;
}

test.describe('owner-curated skill scripts run in docker sandbox', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await createSkillAndCode(request);
    await request.dispose();
  });

  test('visitor chat invokes skill script tool → throbber + sandbox stdout in reply',
    async ({ browser, playwright }) => {
      // 让 mock LLM 下一步必调 skill_marker-emitter_run。pi-agent flow
      // 当前 toolSpecRegistry → /inference/stream tools array 之间还有 gap
      // (capabilities enabled 但 tools array 空), scripted path 绕开
      // req.Tools 直接 emit tool_call，路径仍真：mock → useAgent dispatch
      // → POST /tools/skill_marker-emitter_run → sandbox docker → stdout
      // → tool_result → second-turn 文本 echo 进 chat reply。
      const reqCtx = await playwright.request.newContext();
      await scriptMockToolCall(reqCtx, {
        name: `skill_${SKILL_NAME}_run`,
        args: {},
      });
      await reqCtx.dispose();

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      const input = page.locator('[data-testid="chat-input"] input');
      await input.fill('go ahead and run the marker');
      await input.press('Enter');

      // throbber appears as agent dispatches the sandbox skill tool
      await expect(page.getByTestId(TOOL_THROBBER_TESTID))
        .toBeVisible({ timeout: 20_000 });

      // mock echoes [skill_result:...] inside the reply — proves the docker
      // sandbox actually executed the owner-curated bash script
      await expect(page.locator('[data-testid="answer-body"]'))
        .toContainText(MARKER, { timeout: 15_000 });

      await ctx.close();
    });
});

async function createSkillAndCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'b4-token');
  const sid = await initMCP(request, apiToken);
  const skill = await callTool<SkillCreateResp>(request, apiToken, sid, 'skill_create', {
    name: SKILL_NAME,
    prompt: 'When the visitor asks, call the marker tool and report its output.',
    description: 'Emits a recognizable sandbox marker.',
    scripts: [
      {
        filename: SCRIPT_FILENAME,
        language: 'bash',
        content: `echo "${MARKER}"`,
        description: 'Print the test marker to stdout.',
      },
    ],
  });
  await createCodeAttachingSkill(request, csrf, skill.skill_id);
}

async function createCodeAttachingSkill(
  request: APIRequestContext, csrf: string, skillID: string,
): Promise<void> {
  // A.3-IAM-5: 建一个 role 挂 skill，再发码引用 role。
  const roleRes = await request.post('http://localhost:8000/api/admin/roles/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'sandbox-role',
      description: 'sandbox marker fixture role',
      prompt_id: null,
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
      skill_ids: [skillID],
      mcp_server_ids: [],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role failed: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const res = await request.post('http://localhost:8000/api/admin/codes/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code: CODE,
      label: 'Sandbox marker code',
      suggested_questions: [],
      assumed_role_id: role.id,
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create code failed: ${res.status()} ${await res.text()}`);
  }
}
