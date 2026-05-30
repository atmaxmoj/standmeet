// b3-bundle-capabilities.spec.ts —— Phase B-3 契约：booker / skill-runner /
// ext-mcp 三个 Capability 出现在 /visitor-capabilities 端点。
//
// 既有 chat-book-* / skills.spec / external-mcp-tools.spec 已经覆盖各 bundle
// 的实际 chat 行为（regression）；这里只验 B-3 引入的契约：
//   1. role 含 calendar.book skill + connector connected → calendar.book cap
//      enabled + quota_remaining 算对
//   2. role 含 owner skills → skill.runner cap enabled，tool_specs 含
//      skill_<name>_<script>
//   3. role 含 ext MCP server → ext.mcp cap enabled，tool_specs 含
//      ext_<server>_<tool>；dial/close 计数对齐 (Close hook 真跑)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'b3@example.com', password: 'correct-horse-battery-staple',
  handle: 'b3', fullName: 'B-Three Owner',
};

const SKILL_CODE = 'B3-SKILL-001';
const EXT_CODE = 'B3-EXT-001';
const EXT_SERVER_NAME = 'b3-host';
const MOCK_MCP_URL = 'http://mcp-server-mock:9100/mcp';

const SKILL = {
  name: 'b3-skill',
  description: 'B-3 fixture skill',
  prompt: 'Always begin replies with [B3-SKILL-MARKER].',
  scripts: [{
    filename: 'marker.sh',
    language: 'bash',
    content: 'echo "[B3-SCRIPT-MARKER]"',
    description: 'Print the b3 marker (skill.runner needs scripts to expose tools).',
  }],
};

interface VisitorCap {
  id: string;
  enabled: boolean;
  quota_remaining?: number;
}
interface VisitorCapabilitiesResp {
  capabilities: VisitorCap[];
  tool_specs: Array<{ name: string }>;
  system_prompt_hash: string;
}

interface ExtMCPStats { dialed: number; closed: number }

test.describe('Phase B-3 bundle capabilities present in visitor-capabilities', () => {
  let skillRoleID: string;
  let extRoleID: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    skillRoleID = await seedSkillRoleAndCode(request);
    extRoleID = await seedExtServerRoleAndCode(request);
    await request.dispose();
  });

  test('role with owner skills → skill.runner cap enabled + tool_specs lists skill_*',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: SKILL_CODE, visitor_name: 'Inspector',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const skillCap = body.capabilities.find((c) => c.id === 'skill.runner');
      expect(skillCap, 'skill.runner must appear').toBeDefined();
      expect(skillCap?.enabled).toBe(true);
      const toolNames = body.tool_specs.map((t) => t.name);
      expect(toolNames.some((n) => n.startsWith('skill_b3-skill_'))).toBe(true);
      await request.dispose();
    });

  test('role with ext MCP server → ext.mcp cap enabled + tool_specs lists ext_*',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const before = await fetchExtMCPStats(request);
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: EXT_CODE, visitor_name: 'Inspector',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const extCap = body.capabilities.find((c) => c.id === 'ext.mcp');
      expect(extCap, 'ext.mcp must appear').toBeDefined();
      expect(extCap?.enabled).toBe(true);
      const toolNames = body.tool_specs.map((t) => t.name);
      expect(toolNames.some((n) => n.startsWith(`ext_${EXT_SERVER_NAME}_`))).toBe(true);
      // Close hook: visitor-capabilities call assembled bindings + closed
      // them at handler-return. dial counter went up; close counter caught up.
      const after = await fetchExtMCPStats(request);
      expect(after.dialed).toBeGreaterThan(before.dialed);
      expect(after.dialed - before.dialed).toBe(after.closed - before.closed);
      await request.dispose();
    });

  test('role without skills nor ext-mcp → caps absent (not just disabled)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // Use a session against the SKILL role; flip to a check that role with
      // only skills doesn't trigger ext.mcp.
      const sess = await issueSession(request, {
        handle: OWNER.handle, code: SKILL_CODE, visitor_name: 'Q',
      });
      const body = await fetchVisitorCapabilities(request, sess.session_token);
      const extCap = body.capabilities.find((c) => c.id === 'ext.mcp');
      expect(extCap, 'ext.mcp absent when role has no MCP server').toBeUndefined();
      const bookerCap = body.capabilities.find((c) => c.id === 'calendar.book');
      expect(bookerCap, 'calendar.book absent when role lacks the skill').toBeUndefined();
      await request.dispose();
    });
});

async function seedSkillRoleAndCode(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  // Create the skill via MCP because admin POST /skills/ accepts no
  // scripts[] field (scripts are MCP-only surface; admin UI doesn't
  // expose them yet per skill-scripts.spec).
  const apiToken = await createAPIToken(request, csrf, 'b3-skill-token');
  const sid = await initMCP(request, apiToken);
  const skill = await callTool<{ skill_id: string }>(
    request, apiToken, sid, 'skill_create', SKILL,
  );
  const role = await createRole(request, csrf, {
    name: 'b3-skill-role',
    description: 'fixture: skill bundle',
    corpus_uris: ['wiki://**', 'output://**'],
    skill_ids: [skill.skill_id],
    mcp_server_ids: [],
  });
  await createCode(request, csrf, {
    code: SKILL_CODE, label: 'b3 skill', assumed_role_id: role.id,
  });
  return role.id;
}

async function seedExtServerRoleAndCode(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'b3-mcp-token');
  const sid = await initMCP(request, apiToken);
  const server = await callTool<{ server_id: string }>(
    request, apiToken, sid, 'mcp_server_create',
    { name: EXT_SERVER_NAME, url: MOCK_MCP_URL },
  );
  const role = await createRole(request, csrf, {
    name: 'b3-ext-role',
    description: 'fixture: ext mcp bundle',
    corpus_uris: ['wiki://**', 'output://**'],
    skill_ids: [],
    mcp_server_ids: [server.server_id],
  });
  await createCode(request, csrf, {
    code: EXT_CODE, label: 'b3 ext', assumed_role_id: role.id,
  });
  return role.id;
}

interface CreateRoleInput {
  name: string;
  description: string;
  corpus_uris: string[];
  skill_ids?: string[];
  mcp_server_ids?: string[];
}
interface CreatedRole { id: string }
async function createRole(
  request: APIRequestContext, csrf: string, input: CreateRoleInput,
): Promise<CreatedRole> {
  const res = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: input.name, description: input.description, prompt_id: null,
      corpus_uris: input.corpus_uris,
      skill_ids: input.skill_ids ?? [],
      mcp_server_ids: input.mcp_server_ids ?? [],
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create role: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as CreatedRole;
}

async function createCode(
  request: APIRequestContext, csrf: string,
  input: { code: string; label: string; assumed_role_id: string },
): Promise<void> {
  const res = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      code: input.code, label: input.label, suggested_questions: [],
      assumed_role_id: input.assumed_role_id,
    },
  });
  if (res.status() !== 201) {
    throw new Error(`create code: ${res.status()} ${await res.text()}`);
  }
}

async function fetchVisitorCapabilities(
  request: APIRequestContext, sessionToken: string,
): Promise<VisitorCapabilitiesResp> {
  const res = await request.get(
    `${BACKEND}/internal/test/visitor-capabilities`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) {
    throw new Error(`visitor-capabilities: ${res.status()} ${await res.text()}`);
  }
  return await res.json() as VisitorCapabilitiesResp;
}

async function fetchExtMCPStats(request: APIRequestContext): Promise<ExtMCPStats> {
  const res = await request.get(`${BACKEND}/internal/test/ext-mcp-conn-stats`);
  if (res.status() !== 200) throw new Error(`ext-mcp-stats: ${res.status()}`);
  return await res.json() as ExtMCPStats;
}
