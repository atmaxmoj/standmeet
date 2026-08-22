// connector-agent-rig.ts —— 「装一个 openapi 连接器 → 连上 → 授权 → 起一个访客会话」这套器材。
//
// 从 connector-agent-tools.spec.ts 拆出来的：那边到了 350 行的闸，而**同一套器材**
// 现在有第二个使用者（工具名那条，见 connector-agent-tool-names.spec.ts）。
// 拆的是器材，不是断言 —— 每条用例断什么仍然写在它自己的 spec 里。

import { expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { resetMockGCal, MOCK_GCAL_CREDS } from '@/fixtures/gcal';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export const AGENT_OWNER = {
  email: 'connector-agent-tools@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'agenttools',
  fullName: 'Agent Tools Owner',
};

/**
 * MOCK_OAUTH2_SCHEME —— 样本 spec 共用的 securityScheme。
 * connectConnector 走的是这套 dance；样本 spec 换一种鉴权，红就会落在连接那一段而不是
 * 落在这条用例真正要考的东西上。
 */
export const MOCK_OAUTH2_SCHEME = {
  oauth2: {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'http://localhost:9000/google-oauth/auth',
        tokenUrl: 'http://external-mock:9000/google-oauth/token',
        scopes: {
          'contacts.read': 'read contacts',
          'deals.write': 'write deals',
        },
      },
    },
  },
} as const;

// CreateBody —— POST /api/admin/connectors 的入参（openapi 连接器）。
export interface CreateBody {
  spec: unknown;
  binding?: unknown;               // 品类绑定（可选；agent-only 连接器无绑定）
  expose_as_agent_tools?: boolean; // 暴露意图开关
}
interface CreateResult { status: number; id?: string; error?: string }

async function createConnector(
  request: APIRequestContext, csrf: string, body: CreateBody,
): Promise<CreateResult> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf }, data: body,
  });
  const json = await res.json().catch(() => ({})) as { id?: string; error?: string };
  return { status: res.status(), id: json.id, error: json.error };
}

// connectConnector —— 存 oauth2 凭据（spec 派生）+ 跑 mock dance 把连接器连上。
async function connectConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const credRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/credentials`,
    { headers: { 'X-Csrftoken': csrf }, data: MOCK_GCAL_CREDS },
  );
  expect(credRes.status()).toBe(200);
  const initRes = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/connect`,
    { headers: { 'X-Csrftoken': csrf } },
  );
  expect(initRes.status()).toBe(200);
  const { auth_url } = await initRes.json() as { auth_url: string };
  const cb = await request.get(auth_url);
  expect(cb.status()).toBe(200);
}

export async function disconnectConnector(
  request: APIRequestContext, csrf: string, id: string,
): Promise<void> {
  const res = await request.post(
    `${BACKEND}/api/admin/connectors/${encodeURIComponent(id)}/disconnect`,
    { headers: { 'X-Csrftoken': csrf }, data: {} },
  );
  expect(res.status()).toBe(200);
}

// createAndConnect —— 建 openapi 连接器 + 连上，返回 connector id（断 201 + connected）。
export async function createAndConnect(
  request: APIRequestContext, csrf: string, body: CreateBody,
): Promise<string> {
  const r = await createConnector(request, csrf, body);
  expect(r.status, r.error ?? '').toBe(201);
  await connectConnector(request, csrf, r.id!);
  return r.id!;
}

// ─── session tool-spec inspection（带 description）───
export interface ToolSpecRow { name: string; description?: string }

export async function sessionToolSpecs(
  request: APIRequestContext, sessionToken: string,
): Promise<ToolSpecRow[]> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as { tool_specs: ToolSpecRow[] };
  return body.tool_specs;
}

export async function sessionToolNames(
  request: APIRequestContext, sessionToken: string,
): Promise<string[]> {
  return (await sessionToolSpecs(request, sessionToken)).map((t) => t.name);
}

// startSession —— 发一张码（granted_skills = 要授的 agent-tool 名）+ 起访客会话。
export async function startSession(
  request: APIRequestContext, csrf: string, grantedTools: readonly string[],
): Promise<VisitorSession> {
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: grantedTools });
  return await issueSession(request, {
    handle: AGENT_OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
  });
}

// diagAgentCall —— 直跑某 agent-tool（op）一次，注入 auth 调 SaaS，回原始响应 status。
// 证明运行时把 op 调成了真 SaaS 调用（mock 录到落点），不经 LLM 脚本。
export async function diagAgentCall(
  request: APIRequestContext, csrf: string, id: string,
  op: string, args: Record<string, unknown>,
): Promise<number> {
  const res = await request.post(
    `${BACKEND}/api/admin/diag/connector/${encodeURIComponent(id)}/agent-call`,
    { headers: { 'X-Csrftoken': csrf }, data: { op, args } },
  );
  return res.status();
}

export async function initOwner(playwright: Playwright): Promise<{
  request: APIRequestContext; csrf: string;
}> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: AGENT_OWNER.email, password: AGENT_OWNER.password,
    handle: AGENT_OWNER.handle, fullName: AGENT_OWNER.fullName,
  });
  const { csrf } = await login(request, AGENT_OWNER.email, AGENT_OWNER.password);
  await resetMockGCal(request);
  return { request, csrf };
}
