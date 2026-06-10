// tool-endpoint-skill.spec.ts —— visitor 通过 per-tool HTTP 端点直调
// owner curated skill script。skill_<skillName>_<scriptStem> tool 名
// 跟 LLM 看到的一字不差；executor 走 sandbox 跑 owner 的脚本，stdout
// 落进 result.stdout 给前端。
//
// 业务故事：owner 在 admin 加一个 echo skill (bash: echo "PING")，
// 绑到 PING-001 code。recruiter 持 PING-001 入 session，前端 (pi-
// agent-core) 调 POST /sessions/{id}/tools/skill_echo_main → 200 +
// ok:true + result.stdout='PING'。换持没挂 echo skill 的 code →
// 404 capability_not_enabled。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool as callMCPTool, initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';
import type { SessionCapability, VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'skill-tool@example.com', password: 'correct-horse-battery-staple',
  handle: 'skill-tool', fullName: 'Skill Tool Owner',
};

const CODE_WITH_SKILL = 'SKILL-GRANT';
const CODE_NO_SKILL = 'SKILL-NONE';
const SKILL_NAME = 'echo';
const SCRIPT_FILENAME = 'main.sh';
const MARKER = 'PING';
const TOOL_NAME = `skill_${SKILL_NAME}_main`;

interface SkillCreateResp { skill_id: string; name: string }

interface SkillToolResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  error?: string;
}

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: SkillToolResult;
  capability_state?: SessionCapability[];
}

async function callSkillTool(
  request: APIRequestContext, sess: VisitorSession,
): Promise<{ status: number; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${TOOL_NAME}`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: {},
    },
  );
  const status = res.status();
  const body = await res.json() as ToolResp;
  return { status, body };
}

async function seedOwnerWithSkill(request: APIRequestContext): Promise<string> {
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'skill-tool-token');
  const sid = await initMCP(request, apiToken);
  const skill = await callMCPTool<SkillCreateResp>(
    request, apiToken, sid, 'skill_create',
    {
      name: SKILL_NAME,
      prompt: 'echo a ping marker',
      description: 'Echoes a fixed marker for the tool-endpoint spec.',
      scripts: [{
        filename: SCRIPT_FILENAME, language: 'bash',
        content: `echo "${MARKER}"`,
        description: 'Print PING marker.',
      }],
    },
  );
  return skill.skill_id;
}

async function createRoleAndCode(
  request: APIRequestContext, csrf: string, skillID: string | null, code: string,
): Promise<void> {
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: `role-${code}`, description: 'role for skill-tool spec',
      prompt_id: null, corpus_uris: ['wiki://**', 'output://**'],
      skill_ids: skillID ? [skillID] : [], mcp_server_ids: [],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code, label: code, ghosts: [],
      assumed_role_id: role.id,
    },
  });
  if (codeRes.status() !== 201) {
    throw new Error(`create code: ${codeRes.status()} ${await codeRes.text()}`);
  }
}

test.describe('tool endpoint · owner-curated skill script', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    const skillID = await seedOwnerWithSkill(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createRoleAndCode(request, csrf, skillID, CODE_WITH_SKILL);
    await createRoleAndCode(request, csrf, null, CODE_NO_SKILL);
    await request.dispose();
  });

  test('role granted with skill → 200 + ok:true + result.stdout contains marker',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE_WITH_SKILL, visitor_name: 'V',
      });
      const { status, body } = await callSkillTool(request, sess);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.result?.stdout, 'sandbox stdout in result').toContain(MARKER);
      expect(body.result?.exit_code).toBe(0);
      await request.dispose();
    });

  test('role granted with skill → capability_state lists skill.runner enabled',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE_WITH_SKILL, visitor_name: 'V',
      });
      const { body } = await callSkillTool(request, sess);
      const skillCap = body.capability_state?.find(c => c.id === 'skill.runner');
      expect(skillCap, 'skill.runner cap visible').toBeDefined();
      expect(skillCap?.enabled).toBe(true);
      await request.dispose();
    });

  test('role NOT granting skill → 404 + capability_not_enabled',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: CODE_NO_SKILL, visitor_name: 'V',
      });
      const { status, body } = await callSkillTool(request, sess);
      expect(status).toBe(404);
      expect(body.reason).toBe('capability_not_enabled');
      await request.dispose();
    });
});
