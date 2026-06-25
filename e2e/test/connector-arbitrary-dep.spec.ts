// connector-arbitrary-dep.spec.ts —— §一 任意性（命门）
//
// The dependency-resolution refactor must be CONNECTOR-AGNOSTIC: gating a
// capability on a connector being connected must work for ANY named dep
// provider, not just the two we happen to ship (calendar / smtp). This is
// the 命门 of the refactor — if the mechanism is secretly hard-wired to
// "calendar" it passes the gcal specs and still ships a broken abstraction.
//
// We register a SYNTHETIC connector "X" (dep-provider:test) that is NOT
// calendar/smtp, and the generic test MCP plugin (mock-stack/mcp) declares
// one tool with `Requires:["dep-provider:test"]`. Assertions:
//   (a) X not connected → that plugin tool is ABSENT from the issued
//       session tool spec (single global gate, all walks).
//   (b) X connected (toggle) → tool PRESENT and calling it returns X's
//       proxied result.
//   (c) X's secret never reaches the plugin / any leak surface.
//   (d) mid-session X revoked → friendly degrade (no 500 / stack / secret).
//
// RED / TDD: until the host dep-provider registry + `manifest.Requires`
// resolution + handle injection land, "X" can't be registered as a gate
// provider and the Requires tool is either always-on or never resolved →
// these assertions fail. Expected until the refactor lands.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK_MCP_URL = 'http://mcp-server-mock:9100/mcp';

const OWNER = {
  email: 'arbdep@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'arbdep',
  fullName: 'Arb Dep Owner',
};

// The synthetic dep provider name + the plugin tool that Requires it.
// dep-provider:test is the test-only provider id from connector-deps-tests.md §测试哲学.
const DEP_PROVIDER = 'dep-provider:test';
// The mock-stack/mcp plugin tool gated on DEP_PROVIDER. Visitor-side tool
// spec names are namespaced ext_<server>_<tool> (see external-mcp-tools.spec.ts).
const SERVER_NAME = 'dep-tool';
const GATED_TOOL = `ext_${SERVER_NAME}_dep_proxy`;

// A unique marker the synthetic connector "X" proxies back through the tool,
// proving the handle reached the plugin and the call round-tripped.
const X_RESULT_MARKER = '[DEP-X-PROXY-OK]';
// The owner secret bound to connector X. If dependency injection passes a
// CREDENTIAL instead of an opaque handle, this marker leaks. It must NEVER
// appear on any visitor-facing surface.
const X_SECRET_MARKER = '[DEP-X-SECRET-do-not-leak]';

const CODE = 'ARBDEP-001';

interface CreateServerResp {
  server_id: string;
  name: string;
  url: string;
}

interface VisitorCapabilitiesResp {
  tool_specs: readonly { name: string }[];
}

interface ToolResp {
  ok: boolean;
  reason?: string;
  result?: { error?: string; text?: string };
}

// ─── synthetic connector "X" harness toggles ─────────────────────
// All of these hit a backend test-only mock surface that DOES NOT EXIST yet.
// Raw request.post so the spec COMPILES; runtime fails until the harness lands.

// TODO(impl): needs a synthetic connector "X" registered as a dep provider in
// the test build only (dep-provider:test) — register/lookup against the real
// host registry, never in the prod registry. Backend test endpoint to add.
async function registerSyntheticConnectorX(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  await request.post(`${BACKEND}/__mock/connector-x/register`, {
    headers: { 'X-Csrftoken': csrf },
    data: { provider: DEP_PROVIDER, secret: X_SECRET_MARKER, result: X_RESULT_MARKER },
  });
}

// TODO(impl): needs a toggle for X's connected state (Connected() flips
// true/false). Backend test endpoint to add alongside the dep registry.
async function setConnectorXConnected(
  request: APIRequestContext, csrf: string, connected: boolean,
): Promise<void> {
  await request.post(`${BACKEND}/__mock/connector-x/connected`, {
    headers: { 'X-Csrftoken': csrf },
    data: { connected },
  });
}

// ─── tool-spec inspection (operator diag) ───────────────────────

async function sessionToolNames(
  request: APIRequestContext, sessionToken: string,
): Promise<string[]> {
  const res = await request.get(`${BACKEND}/internal/diag/session`, {
    headers: { 'X-Session-Token': sessionToken },
  });
  if (res.status() !== 200) throw new Error(`diag session: ${res.status()}`);
  const body = await res.json() as VisitorCapabilitiesResp;
  return body.tool_specs.map((t) => t.name);
}

async function callGatedTool(
  request: APIRequestContext, convID: string, token: string,
): Promise<{ status: number; text: string; body: ToolResp }> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${convID}/tools/${GATED_TOOL}`,
    { headers: { Authorization: `Bearer ${token}` }, data: {} },
  );
  const text = await res.text();
  let body: ToolResp;
  try { body = JSON.parse(text) as ToolResp; } catch { body = { ok: false }; }
  return { status: res.status(), text, body };
}

// ─── owner setup: register the gated plugin + issue a code ───────

async function registerGatedServerAndCode(
  request: APIRequestContext, csrf: string,
): Promise<void> {
  const apiToken = await createAPIToken(request, csrf, 'arbdep-token');
  const sid = await initMCP(request, apiToken);
  // TODO(impl): needs the mock-stack/mcp plugin to declare a tool with
  // `Requires:["dep-provider:test"]` (manifest gating) AND proxy the injected
  // X handle into its result. mcp_server_create registers the generic mock;
  // the Requires manifest + dep_proxy tool are added to mock-stack/mcp.
  const server = await callTool<CreateServerResp>(
    request, apiToken, sid, 'mcp_server_create',
    { name: SERVER_NAME, url: MOCK_MCP_URL },
  );
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'arbdep-role',
      description: 'attaches the dep-gated plugin',
      prompt_id: null,
      corpus_uris: ['wiki://**', 'output://**', 'writing://**'],
      skill_ids: [],
      mcp_server_ids: [server.server_id],
    },
  });
  if (roleRes.status() !== 201) {
    throw new Error(`create role: ${roleRes.status()} ${await roleRes.text()}`);
  }
  const role = await roleRes.json() as { id: string };
  const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code: CODE, label: 'arbdep code', ghosts: [], assumed_role_id: role.id },
  });
  if (codeRes.status() !== 201 && codeRes.status() !== 200) {
    throw new Error(`create code: ${codeRes.status()} ${await codeRes.text()}`);
  }
}

test.describe('connector dep · arbitrary named provider gates an arbitrary plugin tool', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    await registerSyntheticConnectorX(request, csrf);
    await registerGatedServerAndCode(request, csrf);
  });

  test.afterAll(async () => { await request.dispose(); });

  test('(a) X not connected → the Requires:[X] tool is absent from the session tool spec',
    async () => {
      await setConnectorXConnected(request, csrf, false);
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'V',
      });
      const names = await sessionToolNames(request, sess.session_token);
      expect(names, 'dep-gated tool hidden when X unconnected').not.toContain(GATED_TOOL);
    });

  test('(b) X connected → tool present and calling it returns X\'s proxied result',
    async () => {
      await setConnectorXConnected(request, csrf, true);
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'V',
      });
      const names = await sessionToolNames(request, sess.session_token);
      expect(names, 'dep-gated tool exposed when X connected').toContain(GATED_TOOL);

      const { status, text } = await callGatedTool(
        request, sess.conversation_id, sess.session_token,
      );
      expect(status, 'no server crash').toBeLessThan(500);
      expect(text, 'X proxied result round-trips through the handle')
        .toContain(X_RESULT_MARKER);
    });

  test('(c) X\'s secret never reaches the plugin / any visitor-facing surface',
    async () => {
      await setConnectorXConnected(request, csrf, true);
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'V',
      });
      const { text } = await callGatedTool(
        request, sess.conversation_id, sess.session_token,
      );
      // handle injection passes an opaque handle, never the credential.
      expect(text, 'X secret not in tool result').not.toContain(X_SECRET_MARKER);

      // nor in the admin transcript (tool call + result are persisted there).
      const transcript = await request.get(
        `${BACKEND}/api/admin/conversations/${sess.conversation_id}`,
        { headers: { 'X-Csrftoken': csrf } },
      );
      expect(await transcript.text(), 'X secret not in transcript')
        .not.toContain(X_SECRET_MARKER);
    });

  test('(d) X revoked mid-session → the gated tool degrades friendly (no 500 / stack / secret)',
    async () => {
      await setConnectorXConnected(request, csrf, true);
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'V',
      });
      // tool was exposed at assembly; X drops before the call.
      await setConnectorXConnected(request, csrf, false);

      const { status, body, text } = await callGatedTool(
        request, sess.conversation_id, sess.session_token,
      );
      expect(status, 'no server crash').toBeLessThan(500);
      const msg = `${body.reason ?? ''} ${body.result?.error ?? ''} ${text}`;
      expect(msg, 'friendly reconnect / unavailable hint')
        .toMatch(/unavailable|reconnect|disconnect|not connected|try again/i);
      expect(msg, 'no raw stack / leak')
        .not.toMatch(/panic|goroutine|stack/i);
      expect(msg, 'secret never surfaces even on the error path')
        .not.toContain(X_SECRET_MARKER);
    });
});
