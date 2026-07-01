// connector-corner-extra.spec.ts —— #155 收尾 corner/error stream（设计 §1-9 之外、但属正经
// 边界/错误流的几条，审计 design-vs-test 后补齐）。全 test.fixme（红，未建前）。
//
//   - 429 限流（error stream）：连接器 connected，runtime SaaS 调用回 429 → 友好降级/退避，
//     不崩、不泄、不返垃圾（跟现有 5xx/4xx 降级同族，差在 429 语义=限流可退避）。
//   - 编辑已建连接器的 spec → 凭据表单**重新派生**（换认证 type 后表单跟着变）。
//   - 两个**同 kind(openapi)** 的 calendar 连接器 → 同 §1/§9 槽位规则（exactly one active），
//     补上 kind-coexist 只测了 openapi+protocol 异 kind 的空档。
//
// API/diag 驱动（同 connector-provider-agnostic / connector-binding-jsonata 的 gold 形态）。
// 接口对齐 connector.md §8 校准 + §9：POST /api/admin/connectors {spec,binding}、…/{id}/
// {credentials,connect,status,activate}、PUT …/{id}（编辑）、diag POST /internal/diag/
// connector/{id}/list-busy、mock /__mock/gcal/* 控制面。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { findCapability } from '@/fixtures/capabilities';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MOCK = process.env['JOB_BOARD_MOCK_URL'] ?? 'http://localhost:9000';

const OWNER = {
  email: 'corner-extra@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'cornerowner',
  fullName: 'Corner Extra Owner',
};

// 一份指向 gcal mock 的 openapi calendar spec + binding（freebusy/events.insert）。servers 用
// service-name（backend 容器内打 gcal API + 命中 fail 注入）；/__mock/gcal/* 控制面走 localhost。
const CAL_SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Cal', version: '1' },
  servers: [{ url: 'http://job-board-mock:9000/google-calendar' }],
  paths: {
    '/freeBusy': { post: { operationId: 'freebusy.query', responses: { '200': { description: 'ok' } } } },
    '/events': { post: { operationId: 'events.insert', responses: { '200': { description: 'ok' } } } },
  },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
});
// 统一 binding 格式：request/response 是 JSONata 字符串（跟 binding-jsonata 契约一致）。
const CAL_BINDING = {
  category: 'calendar',
  kind: 'openapi',
  operations: {
    list_busy: { op: 'freebusy.query', request: '{}', response: '{ "busy": calendars.primary.busy }' },
    create_event: { op: 'events.insert', request: '{ "summary": summary }', response: '{ "id": id }' },
  },
};
// 第二份 spec 内容不同（标题不同），但仍是 openapi calendar —— 用来测同 kind 共存。
const CAL_SPEC_2 = CAL_SPEC.replace('"Cal"', '"Cal Two"');

test.describe('connector · extra corner / error stream (wrap-up)', () => {
  // 429 降级 + 同 kind 共存已落地。spec 编辑重派生（PUT + credential-form 派生端）属 #161
  // 通用 admin 路由的凭据表单派生，单列待建，逐条 fixme。

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => { request = await initOwner(playwright); });
  test.afterAll(async () => { await request.dispose(); });

  // 429 限流 → 友好降级（不崩、不泄、不返垃圾）。
  test('429 throttling: runtime SaaS call returns 429 → friendly degrade (no 5xx/stack, no garbage)', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);
    await armMockStatus(request, 'freeBusy', 429);

    const { status, body } = await diagListBusy(request, csrf, id);
    expect(status, 'a 429 must not crash us').toBeLessThan(500);
    const msg = JSON.stringify(body);
    expect(msg, 'friendly throttle hint, back off / try later').toMatch(/again|later|rate|busy|limit|unavailable/i);
    expect(msg, 'does not leak the provider raw error/stack/status code').not.toMatch(/panic|goroutine|stack|429/);
  });

  // 编辑已建连接器的 spec（换认证 type）→ 凭据表单/状态重新派生（#161 PUT /{id} + credential-form）。
  test('edit spec → credential form re-derives (bearer → apiKey changes the fields)', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);

    // 改成 apiKey 认证的同一份 spec。
    const apiKeySpec = CAL_SPEC.replace(
      '{"bearer":{"type":"http","scheme":"bearer"}}',
      '{"apiKey":{"type":"apiKey","in":"header","name":"X-Api-Key"}}',
    );
    const res = await request.put(`${BACKEND}/api/admin/connectors/${id}`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(apiKeySpec), binding: CAL_BINDING },
    });
    expect(res.status(), 'PUT edit spec → 200').toBe(200);

    // 重新派生的凭据表单/需求反映 apiKey（不再要 oauth dance）。
    const form = await request.get(`${BACKEND}/api/admin/connectors/${id}/credential-form`);
    const f = await form.json() as { auth_type?: string; fields?: { key: string }[] };
    expect(f.auth_type, 're-derived → apiKey').toMatch(/api.?key/i);
    expect((f.fields ?? []).map((x) => x.key), 'apiKey field, no longer client_id').toContain('key');
  });

  // 自定义命名的 apiKey scheme（如 "sendgrid"）：存储字段恒为 "key"——注入器读的就是 creds["key"]
  // （json:"key" 写死）。若 credform 按 scheme 名派生（"sendgrid"），owner 填错字段 → 注入空 key →
  // 静默 401。scheme 名/位置是 HTTP 落点，跟存储字段名正交。回归守护。
  test('named apiKey scheme → credential field stays "key", never the scheme name', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);

    const namedSpec = CAL_SPEC.replace(
      '{"bearer":{"type":"http","scheme":"bearer"}}',
      '{"sendgrid":{"type":"apiKey","in":"header","name":"X-Custom-Key"}}',
    );
    const res = await request.put(`${BACKEND}/api/admin/connectors/${id}`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(namedSpec), binding: CAL_BINDING },
    });
    expect(res.status(), 'PUT named-apiKey spec → 200').toBe(200);

    const form = await request.get(`${BACKEND}/api/admin/connectors/${id}/credential-form`);
    const f = await form.json() as { fields?: { key: string }[] };
    const keys = (f.fields ?? []).map((x) => x.key);
    expect(keys, 'storage field is "key" (matches the injector), not the scheme name').toContain('key');
    expect(keys, 'never keyed by the scheme name "sendgrid"').not.toContain('sendgrid');
  });

  // 两个同 kind(openapi) calendar → exactly one active（§1/§9 槽位规则，不限异 kind）。
  test('two same-kind (openapi) calendars → exactly one active, slot rule same as cross-kind', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const a = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);
    const b = await assembleOpenapiCalendar(request, csrf, CAL_SPEC_2, CAL_BINDING);
    expect(b, 'two distinct openapi calendar connectors').not.toBe(a);

    // 两个都连上，但品类槽exactly one active。
    const rows = await listConnectors(request);
    const cals = rows.filter((c) => c.category === 'calendar');
    expect(cals.length, 'two connectors of the same category coexist').toBeGreaterThanOrEqual(2);
    expect(cals.filter((c) => c.active).length, 'exactly one active').toBe(1);

    // 显式 activate 另一个 → 槽位移交。
    await request.post(`${BACKEND}/api/admin/connectors/${b}/activate`, { headers: { 'X-Csrftoken': csrf }, data: {} });
    const after = (await listConnectors(request)).filter((c) => c.category === 'calendar');
    expect(after.find((c) => c.id === b)?.active, 'after activate, b becomes active').toBe(true);
    expect(after.find((c) => c.id === a)?.active, 'a falls back to inactive').toBe(false);

    // dep-gating 仍开（至少一个 active connected）。
    const cap = await findCapability(request, csrf, 'calendar.book');
    expect(cap?.dependency?.connected, 'an active connected exists → still un-gated').toBe(true);
  });
});

// ─── helpers (inline; promote 到 fixtures/connector-corner.ts 实现转绿时) ───

interface ConnRow { id: string; category: string; kind: string; active: boolean; connected: boolean }

async function initOwner(playwright: Playwright): Promise<APIRequestContext> {
  resetInstance();
  const request = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await login(request, OWNER.email, OWNER.password);
  return request;
}

// assembleOpenapiCalendar —— 建 openapi calendar 连接器 + 存 bearer 凭据 + connect。返回 id。
async function assembleOpenapiCalendar(
  request: APIRequestContext, csrf: string, spec: string, binding: unknown,
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf }, data: { spec: JSON.parse(spec), binding },
  });
  if (res.status() !== 201) throw new Error(`create connector: ${res.status()}`);
  const id = (await res.json() as { id: string }).id;
  await request.post(`${BACKEND}/api/admin/connectors/${id}/credentials`, {
    headers: { 'X-Csrftoken': csrf }, data: { token: 'test-bearer-token' },
  });
  await request.post(`${BACKEND}/api/admin/connectors/${id}/connect`, {
    headers: { 'X-Csrftoken': csrf }, data: {},
  });
  return id;
}

async function listConnectors(request: APIRequestContext): Promise<ConnRow[]> {
  const res = await request.get(`${BACKEND}/api/admin/connectors`);
  return (await res.json() as { connectors?: ConnRow[] }).connectors ?? [];
}

// armMockStatus —— 让 gcal mock 某 op 持续返指定 HTTP status（429 限流等；times:-1 = 持续，
// 让重试预算耗尽 → 友好降级）。
async function armMockStatus(request: APIRequestContext, op: string, status: number): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/fail`, { data: { op, status, times: -1 } });
}

// diagListBusy —— 直打 runtime（避开 LLM），干净断降级形状。
async function diagListBusy(
  request: APIRequestContext, csrf: string, id: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${BACKEND}/api/admin/diag/connector/${id}/list-busy`, {
    headers: { 'X-Csrftoken': csrf },
    data: { timeMin: '2030-01-01T00:00:00Z', timeMax: '2030-01-02T00:00:00Z' },
  });
  return { status: res.status(), body: await res.json() };
}
