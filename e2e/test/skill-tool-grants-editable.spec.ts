// skill-tool-grants-editable.spec.ts -- F-C-57: the owner needs a way to
// grant out a connector's operation.
//
// The session-side gate checks "does this role's attached skill's
// `allowed_tools` contain `op_<id>`" (`capreg_openapi_agent_tools.go` +
// roleAllowedTools in `wire/dispatcher.go`), but the only entry points that
// could write into `allowed_tools` used to be **marketplace import** and
// **owner-MCP's skill_create**. The GUI had none -- and for a connector the
// owner uploads themselves, the op names are specific to that vendor's doc;
// no marketplace skill could ever declare them. So the checkbox on the
// assembly screen was accepting a grant that **could never be completed**.
//
// The design source says this should exist
// (`docs/design/project/admin.js:3000`): installing "writes a local copy you
// fully own -- afterward you can edit the prompt or **allowed-tools**,
// decoupled from the marketplace." And the `UpdateSkill` SQL has been sitting
// in the sqlc-generated code the whole time, with **not a single caller**.
//
// This spec guards two new surfaces:
//   1. `GET /connectors/agent-ops` -- the owner needs to be able to **know
//      what those operations are called**. The name is normalized by the
//      product itself (`agent_tool_name.go`) and doesn't appear anywhere in
//      the vendor doc, so "make the owner type it by hand from the doc"
//      doesn't count as giving it to them.
//   2. `PUT /skills/{id}` -- writes the name into the skill's allowed_tools.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import {
  AGENT_OWNER, MOCK_OAUTH2_SCHEME, createAndConnect, disconnectConnector, initOwner,
} from '@/fixtures/connector-agent-rig';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.use({ ownerCredentials: { email: AGENT_OWNER.email, password: AGENT_OWNER.password } });

const VENDOR_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Gadget Vendor', version: '1.0.0' },
  servers: [{ url: 'http://external-mock:9000/crm' }],
  paths: {
    '/contacts': {
      get: {
        operationId: 'contacts.list',
        summary: 'List contacts',
        security: [{ oauth2: ['contacts.read'] }],
        responses: { '200': { description: 'contacts' } },
      },
    },
  },
  components: { securitySchemes: MOCK_OAUTH2_SCHEME },
} as const;

interface AgentOpsRow {
  connector_id: string;
  title?: string;
  ops: { name: string; description: string }[];
}

async function agentOps(request: APIRequestContext): Promise<AgentOpsRow[]> {
  const res = await request.get(`${BACKEND}/api/admin/connectors/agent-ops`);
  expect(res.status(), 'the owner can ask which operations are grantable').toBe(200);
  const body = await res.json() as { connectors?: AgentOpsRow[] };
  return body.connectors ?? [];
}

test.describe('skills · a connector operation can be granted from the owner face (F-C-57)', () => {
  let request: APIRequestContext;
  let csrf: string;

  test.beforeEach(async ({ playwright }) => {
    ({ request, csrf } = await initOwner(playwright));
  });
  test.afterEach(async () => { await request.dispose(); });

  test('a connected connector publishes the operation names a skill must carry', async () => {
    const id = await createAndConnect(
      request, csrf, { spec: VENDOR_SPEC, expose_as_agent_tools: true },
    );

    const rows = await agentOps(request);
    const mine = rows.find((r) => r.connector_id === id);
    expect(mine, 'the connected connector is listed').toBeDefined();
    // What's asserted is **this doc's own operation, after normalization** --
    // an empty list wouldn't pass, and neither would another connector's name.
    expect(mine!.ops.map((o) => o.name), 'its operation is named, normalised')
      .toContain('op_contacts_list');
    expect(mine!.title, 'and the row says which vendor it is').toBe('Gadget Vendor');

    // Disconnect -> no longer listed. Offering an operation that can't be
    // called would be asking the owner to grant a permission that never takes effect.
    await disconnectConnector(request, csrf, id);
    const after = await agentOps(request);
    expect(after.find((r) => r.connector_id === id), 'a disconnected connector is not offered')
      .toBeUndefined();
  });

  test('an owner skill can be edited to carry that operation', async () => {
    await createAndConnect(request, csrf, { spec: VENDOR_SPEC, expose_as_agent_tools: true });
    const [op] = (await agentOps(request))[0]!.ops;

    const made = await request.post(`${BACKEND}/api/admin/skills/`, {
      headers: { 'X-Csrftoken': csrf },
      data: { name: 'vendor-contacts', description: 'reach the vendor', prompt: 'Use the vendor.' },
    });
    expect(made.status()).toBe(201);
    const skill = await made.json() as { id: string };

    const put = await request.put(`${BACKEND}/api/admin/skills/${skill.id}`, {
      headers: { 'X-Csrftoken': csrf },
      data: {
        name: 'vendor-contacts', description: 'reach the vendor',
        prompt: 'Call the vendor when asked about contacts.',
        allowed_tools: [op!.name],
      },
    });
    expect(put.status(), 'the owner face accepts a tool grant').toBe(200);
    const saved = await put.json() as { allowed_tools: string[]; prompt: string };
    // What comes back must be **the copy that was actually stored**:
    // asserting only 200 would let an implementation that drops
    // allowed_tools pass too.
    expect(saved.allowed_tools, 'and the grant is what comes back').toEqual([op!.name]);
    expect(saved.prompt).toContain('Call the vendor');
  });
});
