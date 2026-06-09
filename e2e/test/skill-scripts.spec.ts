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
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
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
    async ({ browser }) => {
      // 自然 LLM 流程：visitor 输入 -> useAgent 把 tool_specs (含
      // skill_marker-emitter_run) 一起发 /inference/stream -> mock 的
      // nextSkillOrExtToolCall 看到 req.Tools 含 skill_* 就调一次 ->
      // 浏览器接收 tool_call SSE -> dispatch tool -> sandbox 跑 ->
      // 第二轮 mock 把 [skill_result:...] echo 回 chat。
      // 不用 scriptMockToolCall —— 本测就是验自然路径。
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }
      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill('go ahead and run the marker');
      await input.press('Enter');

      // 证据走持久信号:reply 里含 docker sandbox 执行脚本的 stdout marker。
      // throbber 是单值瞬时态(本地 sandbox 往返快、React batch 掉),不在这赌;
      // 生命周期由 visitor-chat-throbber-* 专门验。
      await expect(page.locator('[data-testid="answer-body"]'))
        .toContainText(MARKER, { timeout: 20_000 });

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
