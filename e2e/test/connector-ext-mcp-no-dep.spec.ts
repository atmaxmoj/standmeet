// connector-ext-mcp-no-dep.spec.ts —— §一 ext-mcp 默认不接 dep
//
// Trust hierarchy: an owner-runtime EXTERNAL MCP plugin (the lowest-trust
// loader — it's someone else's process the owner merely registered) must NOT
// be silently injected a connector dependency handle, even when it declares
// `Requires:["calendar"]` and calendar IS connected. Connector handles carry
// the owner's authority; auto-resolving them for an arbitrary ext-mcp server
// would let any registered server reach into the owner's Google account.
//
// Expectation: the ext-mcp server's Requires:[calendar] tool stays HIDDEN /
// the dep is NOT resolved — even with calendar connected — UNLESS the owner
// explicitly authorizes the dep grant for that server.
//
// RED / TDD: until the refactor (a) reads ext-mcp manifest Requires and
// (b) defaults ext-mcp dep-grant to DENY (explicit owner authorization
// required), the tool would either resolve the handle automatically (leak of
// authority) or never gate at all. Either way these assertions fail until the
// "lowest-trust = no implicit dep" rule lands.
//
// Modeled on external-mcp-tools.spec.ts (registers mcp-server-mock via
// mcp_server_create) but the registered server's tool declares a connector
// Requires, and we assert the dep is NOT auto-granted.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import {
  MOCK_GCAL_CREDS, getGCalStatus, initGCalOAuth, resetMockGCal, saveGCalCredentials,
} from '@/fixtures/gcal';
import { issueSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK_MCP_URL = 'http://mcp-server-mock:9100/mcp';

const OWNER = {
  email: 'extmcpdep@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'extmcpdep',
  fullName: 'Ext MCP Dep Owner',
};

const SERVER_NAME = 'cal-ext';
// ext-mcp plugin tool that declares Requires:["calendar"]. Visitor-side tool
// spec name is namespaced ext_<server>_<tool>.
const REQUIRES_CAL_TOOL = `ext_${SERVER_NAME}_needs_calendar`;
const CODE = 'EXTMCPDEP-001';

interface CreateServerResp { server_id: string; name: string; url: string }
interface VisitorCapabilitiesResp { tool_specs: readonly { name: string }[] }

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

async function connectCalendar(request: APIRequestContext, csrf: string): Promise<void> {
  await resetMockGCal(request);
  await saveGCalCredentials(request, csrf, MOCK_GCAL_CREDS);
  const { auth_url } = await initGCalOAuth(request, csrf);
  const res = await request.get(auth_url);
  if (res.status() !== 200) throw new Error(`oauth flow: ${res.status()}`);
  const status = await getGCalStatus(request);
  if (!status.connected) throw new Error('calendar not connected after oauth');
}

// registerExtServerAndCode —— register the mock-stack/mcp server (via mcp_server_create),
// whose `needs_calendar` tool declares `_meta.requires:["calendar"]` so the host reads a
// real ext-mcp manifest Requires (mock-stack/mcp/requires_fixture.go), then issue a code.
async function registerExtServerAndCode(
  request: APIRequestContext, csrf: string,
): Promise<string> {
  const apiToken = await createAPIToken(request, csrf, 'extmcpdep-token');
  const sid = await initMCP(request, apiToken);
  const server = await callTool<CreateServerResp>(
    request, apiToken, sid, 'mcp_server_create',
    { name: SERVER_NAME, url: MOCK_MCP_URL },
  );
  const roleRes = await request.post(`${BACKEND}/api/admin/roles/`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      name: 'extmcpdep-role',
      description: 'ext-mcp server declaring Requires:[calendar]',
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
    data: { code: CODE, label: 'extmcpdep code', ghosts: [], assumed_role_id: role.id },
  });
  if (codeRes.status() !== 201 && codeRes.status() !== 200) {
    throw new Error(`create code: ${codeRes.status()} ${await codeRes.text()}`);
  }
  return server.server_id;
}

// authorizeDepGrant —— owner-side explicit consent that lifts the lowest-trust default
// and grants a connector dep to an ext-mcp server. Admin endpoint:
// POST /api/admin/mcp-servers/{id}/dep-grants (routes/admin/mcp_servers.go:49).
async function authorizeDepGrant(
  request: APIRequestContext, csrf: string, serverID: string, dep: string,
): Promise<void> {
  await request.post(`${BACKEND}/api/admin/mcp-servers/${serverID}/dep-grants`, {
    headers: { 'X-Csrftoken': csrf },
    data: { dep },
  });
}

test.describe('connector dep · ext-mcp plugin is NOT auto-injected a dep handle (lowest trust)', () => {
  let request: APIRequestContext;
  let csrf: string;
  let serverID: string;

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    request = await playwright.request.newContext({ timeout: 30_000 });
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    // Calendar IS connected — the point is the dep still isn't auto-resolved.
    await connectCalendar(request, csrf);
    serverID = await registerExtServerAndCode(request, csrf);
  });

  test.afterAll(async () => { await request.dispose(); });

  test('calendar connected but ext-mcp Requires:[calendar] tool stays hidden (no implicit grant)',
    async () => {
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'V',
      });
      const names = await sessionToolNames(request, sess.session_token);
      expect(names, 'ext-mcp dep tool NOT auto-resolved despite calendar connected')
        .not.toContain(REQUIRES_CAL_TOOL);
    });

  test('after the owner explicitly authorizes the dep grant, the tool resolves',
    async () => {
      await authorizeDepGrant(request, csrf, serverID, 'calendar');
      const sess = await issueSession(request, {
        handle: OWNER.handle, mode: 'code', code: CODE, visitor_name: 'V',
      });
      const names = await sessionToolNames(request, sess.session_token);
      expect(names, 'ext-mcp dep tool present after explicit owner authorization')
        .toContain(REQUIRES_CAL_TOOL);
    });
});
