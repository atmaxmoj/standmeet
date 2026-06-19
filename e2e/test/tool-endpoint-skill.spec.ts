// tool-endpoint-skill.spec.ts —— Phase C 合约矩阵（确定性、不走 LLM loop）：
// visitor 通过 per-tool HTTP 端点直调新的两个**通用** skill 工具，验 L2/L3
// 合约 + ACL，并锁死「eager 每脚本一 tool 已删」。
//
//   • skill_use({name})         → L2：回 SKILL.md（frontmatter name+description
//                                  + body）。授权外的 name → result.error。
//   • skill_run_script({name,    → L3：sandbox 跑脚本 → {stdout,stderr,exit_code}。
//      script,args})
//   • 旧 skill_<name>_<script>   → 404（eager per-script tool 已被替换、不再存在）。
//   • role 不挂任何 skill        → skill.runner 隐藏 → 两个端点都 404
//                                  capability_not_enabled。
//   • capability_state           → role 含 skill 时仍列 skill.runner enabled。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

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
const STDOUT_MARKER = 'PING';
const L1_DESC_MARKER = '[SKILL-L1-DESC]';
const L2_BODY_MARKER = '[SKILL-L2-BODY]';
// the eager-model per-script tool name that must NO LONGER resolve.
const LEGACY_TOOL_NAME = `skill_${SKILL_NAME}_main`;

interface SkillCreateResp { skill_id: string; name: string }

interface SkillUseResult { skill_md?: string; error?: string }
interface SkillRunResult {
  stdout?: string; stderr?: string; exit_code?: number; timed_out?: boolean; error?: string;
}
interface ToolResp<R> {
  ok: boolean;
  reason?: string;
  result?: R;
  capability_state?: SessionCapability[];
}

async function callTool<R>(
  request: APIRequestContext, sess: VisitorSession, tool: string,
  data: Record<string, unknown>,
): Promise<{ status: number; body: ToolResp<R> }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/tools/${tool}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` }, data },
  );
  return { status: res.status(), body: await res.json() as ToolResp<R> };
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
      description: `Echoes a fixed marker ${L1_DESC_MARKER}.`,
      prompt: `When asked, run the script and report ${L2_BODY_MARKER}.`,
      scripts: [{
        filename: SCRIPT_FILENAME, language: 'bash',
        content: `echo "${STDOUT_MARKER}"`,
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
    data: { code, label: code, ghosts: [], assumed_role_id: role.id },
  });
  if (codeRes.status() !== 201) {
    throw new Error(`create code: ${codeRes.status()} ${await codeRes.text()}`);
  }
}

test.describe('tool endpoint · Phase C generic skill tools (skill_use / skill_run_script)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    const skillID = await seedOwnerWithSkill(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createRoleAndCode(request, csrf, skillID, CODE_WITH_SKILL);
    await createRoleAndCode(request, csrf, null, CODE_NO_SKILL);
    await request.dispose();
  });

  test('L2: skill_use(granted) → 200 + SKILL.md (frontmatter name + body marker)',
    async ({ playwright }) => { await assertSkillUseGranted(playwright); });

  test('L3: skill_run_script(granted) → 200 + sandbox stdout + exit 0',
    async ({ playwright }) => { await assertRunScriptGranted(playwright); });

  test('skill.runner capability_state enabled when role grants a skill',
    async ({ playwright }) => { await assertCapabilityState(playwright); });

  test('eager per-script tool is GONE: legacy skill_<name>_<script> → 404',
    async ({ playwright }) => { await assertLegacyToolGone(playwright); });

  test('per-skill ACL: skill_use(name the role does not grant) → result.error, no disclosure',
    async ({ playwright }) => { await assertUngrantedNameDenied(playwright); });

  test('role grants no skill → skill_use AND skill_run_script → 404 capability_not_enabled',
    async ({ playwright }) => { await assertNoSkillRole(playwright); });
});

async function sessFor(
  playwright: Playwright, code: string,
): Promise<{ request: APIRequestContext; sess: VisitorSession }> {
  const request = await playwright.request.newContext();
  const sess = await issueSession(request, { handle: OWNER.handle, code, visitor_name: 'V' });
  return { request, sess };
}

async function assertSkillUseGranted(playwright: Playwright): Promise<void> {
  const { request, sess } = await sessFor(playwright, CODE_WITH_SKILL);
  const { status, body } = await callTool<SkillUseResult>(request, sess, 'skill_use', { name: SKILL_NAME });
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.result?.skill_md, 'SKILL.md body').toContain(L2_BODY_MARKER);
  expect(body.result?.skill_md, 'SKILL.md frontmatter name').toContain(`name: ${SKILL_NAME}`);
  await request.dispose();
}

async function assertRunScriptGranted(playwright: Playwright): Promise<void> {
  const { request, sess } = await sessFor(playwright, CODE_WITH_SKILL);
  const { status, body } = await callTool<SkillRunResult>(
    request, sess, 'skill_run_script', { name: SKILL_NAME, script: SCRIPT_FILENAME, args: {} },
  );
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.result?.stdout, 'sandbox stdout').toContain(STDOUT_MARKER);
  expect(body.result?.exit_code).toBe(0);
  await request.dispose();
}

async function assertCapabilityState(playwright: Playwright): Promise<void> {
  const { request, sess } = await sessFor(playwright, CODE_WITH_SKILL);
  const { body } = await callTool<SkillUseResult>(request, sess, 'skill_use', { name: SKILL_NAME });
  const cap = body.capability_state?.find(c => c.id === 'skill.runner');
  expect(cap, 'skill.runner cap visible').toBeDefined();
  expect(cap?.enabled).toBe(true);
  await request.dispose();
}

async function assertLegacyToolGone(playwright: Playwright): Promise<void> {
  const { request, sess } = await sessFor(playwright, CODE_WITH_SKILL);
  const { status } = await callTool<SkillRunResult>(request, sess, LEGACY_TOOL_NAME, {});
  expect(status).toBe(404);
  await request.dispose();
}

async function assertUngrantedNameDenied(playwright: Playwright): Promise<void> {
  const { request, sess } = await sessFor(playwright, CODE_WITH_SKILL);
  // skill.runner is enabled (role grants `echo`), but `ghost-skill` isn't granted.
  const { status, body } = await callTool<SkillUseResult>(request, sess, 'skill_use', { name: 'ghost-skill' });
  expect(status).toBe(200);
  expect(body.result?.error, 'error for ungranted name').toMatch(/not available|not granted|unknown/i);
  expect(body.result?.skill_md ?? '').not.toContain(L2_BODY_MARKER);
  await request.dispose();
}

async function assertNoSkillRole(playwright: Playwright): Promise<void> {
  const { request, sess } = await sessFor(playwright, CODE_NO_SKILL);
  const useRes = await callTool<SkillUseResult>(request, sess, 'skill_use', { name: SKILL_NAME });
  expect(useRes.status).toBe(404);
  expect(useRes.body.reason).toBe('capability_not_enabled');
  const runRes = await callTool<SkillRunResult>(
    request, sess, 'skill_run_script', { name: SKILL_NAME, script: SCRIPT_FILENAME, args: {} },
  );
  expect(runRes.status).toBe(404);
  expect(runRes.body.reason).toBe('capability_not_enabled');
  await request.dispose();
}
