// agent-skills-grant.ts —— A.3-IAM-5: translate "issue code with granted_skills"
// into "create an owner skill with allowed_tools → create a role attaching that
// skill → issue a code pointing at the role".
//
// The exposed API shape keeps the IssueCodeInput.granted_skills semantics as
// much as possible so existing chat-book-* specs don't need to change their
// business assertions; the fixture internally assembles the role chain.

import type { APIRequestContext } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface IssueCodeInput {
  label?: string;
  granted_skills?: readonly string[];
  max_bookings?: number;
  max_members?: number;
  max_turns_per_session?: number;
  // Whether this code's role emails the owner a notification when a booking is made.
  //
  // The field is named notify_owner —— it's a key declared by **calendar.book
  // itself** in its manifest's role_config, no longer a column on the kernel
  // roles table (that column was called notify_owner_on_booking and is retired).
  // A role's input schema grows from each block's declaration, so the name
  // filled in here must match the manifest.
  notify_owner?: boolean;
}

export interface IssuedCode {
  id: string;
  code: string;
  assumed_role_id: string;
  max_bookings: number | null;
}

interface RoleView { id: string }
interface SkillView { id: string; name: string }

// Counter, to give each issueCodeWithSkills call a unique skill / role name.
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
  const role = await createRoleAttachingSkill(request, csrf, `role-${tag}`, skillID,
    input.notify_owner ?? false);
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
  name: string, skillID: string | null, notifyOwnerOnBooking = false,
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
      notify_owner: notifyOwnerOnBooking,
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

interface VisitorBlocksResp {
  tool_specs: readonly { name: string }[];
}

/** Assert calendar_book is (or isn't) in the assembled tool spec for
 *  a session. Hits /internal/diag/session (operator diag endpoint).
 *  Tool name is snake_case since D-3 (URL ↔ LLM spec 1:1). Block
 *  ID stays dotted ("calendar.book") — that's a separate concern. */
export async function expectCalendarBookExposed(
  request: APIRequestContext, sessionToken: string, exposed: boolean,
): Promise<void> {
  // Blocks now bind ASYNCHRONOUSLY: a JS block's tool specs are cached by a background warm dial
  // (~2s node cold-start) kicked off at session assembly, so the tool appears a beat after the
  // session is created (overlapping the visitor typing). Poll until the assembled tool list matches
  // rather than checking once. `exposed:false` (un-granted) is the stable state and returns on the
  // first read; `exposed:true` waits for the warm to land.
  const deadline = Date.now() + 15_000;
  let names: string[] = [];
  for (;;) {
    const res = await request.get(
      `${BACKEND}/internal/diag/session`,
      { headers: { 'X-Session-Token': sessionToken } },
    );
    if (res.status() !== 200) throw new Error(`visitor-blocks: ${res.status()}`);
    names = (await res.json() as VisitorBlocksResp).tool_specs.map((t) => t.name);
    if (names.includes('calendar_book') === exposed) return;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `expected calendar_book ${exposed ? 'exposed' : 'absent'} within 15s, got tools=${names.join(',')}`,
  );
}
