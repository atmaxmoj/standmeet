// agent-skills-grant.ts —— A.3-IAM-5: 把 "issue code with granted_skills"
// 翻译成 "建一个 owner skill 含 allowed_tools → 建 role 挂这个 skill → 发码
// 指向 role"。
//
// 对外暴露的 API 形态尽量保持 IssueCodeInput.granted_skills 的语义，让现有
// chat-book-* 等 spec 不用改业务断言；fixture 内部负责拼出 role 链。

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface IssueCodeInput {
  label?: string;
  granted_skills?: readonly string[];
  max_bookings?: number;
  max_members?: number;
  max_turns_per_session?: number;
}

export interface IssuedCode {
  id: string;
  code: string;
  assumed_role_id: string;
  max_bookings: number | null;
}

interface RoleView { id: string }
interface SkillView { id: string; name: string }

// 计数器，给每次 issueCodeWithSkills 调用产生 unique skill / role name。
let counter = 0;

export async function issueCodeWithSkills(
  request: APIRequestContext, csrf: string, input: IssueCodeInput = {},
): Promise<IssuedCode> {
  counter += 1;
  const tag = `gcal-${Date.now()}-${counter}`;
  const tools = input.granted_skills ?? [];
  let skillID: string | null = null;
  if (tools.length > 0) {
    const skill = await createSkillWithTools(request, csrf, `skill-${tag}`, tools);
    skillID = skill.id;
  }
  const role = await createRoleAttachingSkill(request, csrf, `role-${tag}`, skillID);
  return await postCode(request, csrf, role.id, input);
}

async function createSkillWithTools(
  request: APIRequestContext, csrf: string,
  name: string, allowedTools: readonly string[],
): Promise<SkillView> {
  const res = await request.post(`${BACKEND}/api/admin/skills/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name,
      description: 'fixture skill',
      prompt: 'granted by test fixture',
      allowed_tools: [...allowedTools],
    },
  });
  if (res.status() !== 201) throw new Error(`create skill: ${res.status()}`);
  return await res.json() as SkillView;
}

async function createRoleAttachingSkill(
  request: APIRequestContext, csrf: string,
  name: string, skillID: string | null,
): Promise<RoleView> {
  const res = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name,
      description: 'fixture role',
      prompt_id: null,
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
      skill_ids: skillID ? [skillID] : [],
      mcp_server_ids: [],
    },
  });
  if (res.status() !== 201) throw new Error(`create role: ${res.status()}`);
  return await res.json() as RoleView;
}

async function postCode(
  request: APIRequestContext, csrf: string,
  roleID: string, input: IssueCodeInput,
): Promise<IssuedCode> {
  const res = await request.post(
    `${BACKEND}/api/admin/codes`,
    {
      data: {
        label: input.label ?? 'gcal-spec',
        assumed_role_id: roleID,
        max_bookings: input.max_bookings ?? null,
        max_members: input.max_members ?? 10,
        max_turns_per_session: input.max_turns_per_session ?? 50,
      },
      headers: { 'X-Csrftoken': csrf },
    },
  );
  if (res.status() !== 200 && res.status() !== 201) {
    throw new Error(`issue code: ${res.status()}`);
  }
  return await res.json() as IssuedCode;
}

// ─── tool-spec inspection (dev/test only endpoint) ──────────────

interface VisitorCapabilitiesResp {
  tool_specs: readonly { name: string }[];
}

/** Assert calendar_book is (or isn't) in the assembled tool spec for
 *  a session. Hits /internal/diag/session (operator diag endpoint).
 *  Tool name is snake_case since D-3 (URL ↔ LLM spec 1:1). Capability
 *  ID stays dotted ("calendar.book") — that's a separate concern. */
export async function expectCalendarBookExposed(
  request: APIRequestContext, sessionToken: string, exposed: boolean,
): Promise<void> {
  const res = await request.get(
    `${BACKEND}/internal/diag/session`,
    { headers: { 'X-Session-Token': sessionToken } },
  );
  if (res.status() !== 200) throw new Error(`visitor-capabilities: ${res.status()}`);
  const body = await res.json() as VisitorCapabilitiesResp;
  const names = body.tool_specs.map((t) => t.name);
  const has = names.includes('calendar_book');
  if (has !== exposed) {
    throw new Error(
      `expected calendar_book ${exposed ? 'exposed' : 'absent'}, ` +
      `got tools=${names.join(',')}`,
    );
  }
}
