// skill-scripts.spec.ts —— owner curates a Skill with a sandbox-executed
// script; the script becomes an MCP-style tool the visitor-facing AI can
// call. mock provider exercises it; the chat reply echoes the tool result
// (因为 mock 模式下 backend echo `[skill_result:...]` block 进 reply 让
// e2e 可以 assert)。
//
// 业务故事：
//   alice 在 Claude Desktop 用 skill_create 给自己加一个 "marker-emitter"
//   skill: 一段 bash 脚本 `echo "[SANDBOX-MARKER]"`。把它绑到 INVITE
//   MARKER-001 (新建 code 时 attach skill_id)；recruiter 用 MARKER-001
//   聊，AI 看到自己手上有 skill_marker-emitter_run tool，调用一次，sandbox
//   docker 隔离运行脚本，stdout=`[SANDBOX-MARKER]`，被打包进 tool_result
//   返给 AI 再传到 chat reply (mock echoes)。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession, sendMessage } from '@/fixtures/visitor';
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

  test('visitor chat invokes skill script tool → sandbox stdout in reply',
    async ({ request }) => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE, visitor_name: 'Recruiter',
      });
      const res = await sendMessage(request, sess, 'go ahead and run the marker');
      expect(res.status()).toBe(200);
      const body = await res.text();
      // Skill script runs in sandbox; mock provider echoes the tool_result
      // text into the SSE stream wrapped in [skill_result:...]. We assert
      // the marker shows up — proves the docker sandbox actually executed
      // the owner-curated bash script end to end.
      expect(body).toContain(MARKER);
    });
});

async function createSkillAndCode(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'b4-token');
  const sid = await initMCP(request, apiToken);
  // skill_create via MCP — same path owner's AI client takes. scripts[] is
  // the new B4 surface.
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
  const res = await request.post('http://localhost:8000/api/admin/codes/', {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code: CODE,
      label: 'Sandbox marker code',
      corpus_permissions: [],
      suggested_questions: [],
      skill_ids: [skillID],
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create code failed: ${res.status()} ${await res.text()}`);
  }
}
