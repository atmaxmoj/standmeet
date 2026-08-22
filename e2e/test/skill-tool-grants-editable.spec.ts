// skill-tool-grants-editable.spec.ts —— F-C-57：owner 要有办法把一个连接器的 operation 授出去。
//
// 会话侧的闸比的是「这个角色挂的技能的 `allowed_tools` 里有没有 `op_<id>`」
// （`capreg_openapi_agent_tools.go` + `wire/dispatcher.go` 的 roleAllowedTools），
// 而写得进 `allowed_tools` 的入口以前只有**市场导入**和 **owner-MCP 的 skill_create**。
// GUI 一个都没有 —— 而 owner 自己传的连接器，op 名字是这份厂商文档特有的，
// 公共市场上不可能有技能声明它们。装配那一屏的复选框因此收下了一次**完不成的授权**。
//
// 设计源写着这件事该存在（`docs/design/project/admin.js:3000`）：安装会「写一份你完全拥有的
// 本地副本 —— 之后可以改 prompt 或 **allowed-tools**，跟市场解耦」。而 `UpdateSkill` 那条 SQL
// 一直躺在 sqlc 生成物里，**一个调用者都没有**。
//
// 这里守两样新面：
//   1. `GET /connectors/agent-ops` —— owner 要能**知道那些 operation 叫什么**。
//      名字是产品自己规范化出来的（`agent_tool_name.go`），厂商文档里没有这个串，
//      所以「让 owner 照着文档手打」不算给过。
//   2. `PUT /skills/{id}` —— 把名字写进技能的 allowed_tools。

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
    // 断的是**这份文档自己那个 operation 规范化之后的名字** —— 一张空清单过不了，
    // 一个别的连接器的名字也过不了。
    expect(mine!.ops.map((o) => o.name), 'its operation is named, normalised')
      .toContain('op_contacts_list');
    expect(mine!.title, 'and the row says which vendor it is').toBe('Gadget Vendor');

    // 断开 → 不再列。授一个调不到的 operation 等于请 owner 授一个不会生效的权限。
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
    // 读回来的必须是**存进去的那一份**：只断 200 的话，一个把 allowed_tools 丢掉的实现也能过。
    expect(saved.allowed_tools, 'and the grant is what comes back').toEqual([op!.name]);
    expect(saved.prompt).toContain('Call the vendor');
  });
});
