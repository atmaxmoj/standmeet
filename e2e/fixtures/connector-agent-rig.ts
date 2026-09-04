// connector-agent-rig.ts —— the rig for "install an openapi connector → connect →
// grant → start a visitor session".
//
// Split out of connector-agent-tools.spec.ts: that file hit the 350-line gate,
// and **the same rig** now has a second user (the tool-names one, see
// connector-agent-tool-names.spec.ts). What's split out is the rig, not the
// assertions —— what each case asserts still lives in its own spec.

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
 * MOCK_OAUTH2_SCHEME —— the securityScheme shared by the sample specs.
 * connectConnector runs this dance; if a sample spec used a different auth,
 * the red would land in the connect step rather than on what the case is
 * actually testing.
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

// CreateBody —— the input to POST /api/admin/connectors (openapi connector).
export interface CreateBody {
  spec: unknown;
  binding?: unknown;               // category binding (optional; agent-only connectors have none)
  expose_as_agent_tools?: boolean; // expose-intent switch
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

// connectConnector —— store the oauth2 credentials (spec-derived) + run the mock
// dance to connect the connector.
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

// createAndConnect —— create an openapi connector + connect it, returning the
// connector id (asserts 201 + connected).
export async function createAndConnect(
  request: APIRequestContext, csrf: string, body: CreateBody,
): Promise<string> {
  const r = await createConnector(request, csrf, body);
  expect(r.status, r.error ?? '').toBe(201);
  await connectConnector(request, csrf, r.id!);
  return r.id!;
}

// ─── session tool-spec inspection (with description) ───
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

// startSession —— issue a code (granted_skills = the agent-tool names to grant) +
// start a visitor session.
export async function startSession(
  request: APIRequestContext, csrf: string, grantedTools: readonly string[],
): Promise<VisitorSession> {
  const code = await issueCodeWithSkills(request, csrf, { granted_skills: grantedTools });
  return await issueSession(request, {
    handle: AGENT_OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
  });
}

// diagAgentCall —— run one agent-tool (op) directly once, injecting auth to call
// the SaaS, and return the raw response status. Proves the runtime turned the op
// into a real SaaS call (the mock recorded the landing), bypassing the LLM script.
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
