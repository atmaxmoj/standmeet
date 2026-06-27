// connector-corner-extra.spec.ts —— #155 收尾 corner/error stream（设计 §1-9 之外、但属正经
// 边界/错误流的几条，审计 design-vs-test 后补齐）。全 test.fixme（红，未建前）。
//
//   - 429 限流（error stream）：连接器 connected，runtime SaaS 调用回 429 → 友好降级/退避，
//     不崩、不泄、不返垃圾（跟现有 5xx/4xx 降级同族，差在 429 语义=限流可退避）。
//   - 编辑已建连接器的 spec → 凭据表单**重新派生**（换认证 type 后表单跟着变）。
//   - 两个**同 kind(openapi)** 的 calendar 连接器 → 同 §1/§9 槽位规则（恰一个 active），
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

// 一份指向 gcal mock 的 openapi calendar spec + binding（freebusy/events.insert）。
const CAL_SPEC = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Cal', version: '1' },
  servers: [{ url: `${MOCK}/__mock/gcal` }],
  paths: {
    '/freeBusy': { post: { operationId: 'freebusy.query', responses: { '200': { description: 'ok' } } } },
    '/events': { post: { operationId: 'events.insert', responses: { '200': { description: 'ok' } } } },
  },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
});
const CAL_BINDING = `category: calendar
kind: openapi
operations:
  list_busy: { op: freebusy.query, request: { body: {} }, response: { busy: "calendars.primary.busy" } }
  create_event: { op: events.insert, request: { body: { summary: "{{.title}}" } }, response: { id: "id" } }
`;
// 第二份 spec 内容不同（不同 operationId 描述），但仍是 openapi calendar —— 用来测同 kind 共存。
const CAL_SPEC_2 = CAL_SPEC.replace('"Cal"', '"Cal Two"');

test.describe('connector · 额外 corner / error stream（收尾）', () => {
  // 红契约：429 降级 / spec 编辑重派生 / 同 kind 共存 —— 均未建（connector.md §1/§4/§9）。
  test.fixme(true, 'pending #155: 429 degrade / spec-edit re-derive / same-kind coexist');

  let request: APIRequestContext;
  test.beforeAll(async ({ playwright }) => { request = await initOwner(playwright); });
  test.afterAll(async () => { await request.dispose(); });

  // 429 限流 → 友好降级（不崩、不泄、不返垃圾）。
  test('429 限流：runtime SaaS 调用回 429 → 友好降级（无 5xx/stack，不返垃圾）', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);
    await armMockStatus(request, 'freebusy', 429);

    const { status, body } = await diagListBusy(request, id);
    expect(status, '429 不该让我们崩').toBeLessThan(500);
    const msg = JSON.stringify(body);
    expect(msg, '友好限流提示，可退避/稍后再试').toMatch(/again|later|rate|busy|limit|unavailable/i);
    expect(msg, '不泄 provider 原始错误/stack/状态码').not.toMatch(/panic|goroutine|stack|429/);
  });

  // 编辑已建连接器的 spec（换认证 type）→ 凭据表单/状态重新派生。
  test('编辑 spec → 凭据表单重新派生（bearer → apiKey 后字段跟着变）', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const id = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);

    // 改成 apiKey 认证的同一份 spec。
    const apiKeySpec = CAL_SPEC.replace(
      '{"bearer":{"type":"http","scheme":"bearer"}}',
      '{"apiKey":{"type":"apiKey","in":"header","name":"X-Api-Key"}}',
    );
    const res = await request.put(`${BACKEND}/api/admin/connectors/${id}`, {
      headers: { 'X-Csrftoken': csrf }, data: { spec: apiKeySpec, binding: CAL_BINDING },
    });
    expect(res.status(), 'PUT 编辑 spec → 200').toBe(200);

    // 重新派生的凭据表单/需求反映 apiKey（不再要 oauth dance）。
    const form = await request.get(`${BACKEND}/api/admin/connectors/${id}/credential-form`);
    const f = await form.json() as { auth_type?: string; fields?: { key: string }[] };
    expect(f.auth_type, '重派生 → apiKey').toMatch(/api.?key/i);
    expect((f.fields ?? []).map((x) => x.key), 'apiKey 字段，不再是 client_id').toContain('key');
  });

  // 两个同 kind(openapi) calendar → 恰一个 active（§1/§9 槽位规则，不限异 kind）。
  test('两个同 kind(openapi) calendar → 恰一个 active，槽位规则与异 kind 一致', async () => {
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    const a = await assembleOpenapiCalendar(request, csrf, CAL_SPEC, CAL_BINDING);
    const b = await assembleOpenapiCalendar(request, csrf, CAL_SPEC_2, CAL_BINDING);
    expect(b, '两个不同的 openapi calendar 连接器').not.toBe(a);

    // 两个都连上，但品类槽恰一个 active。
    const rows = await listConnectors(request);
    const cals = rows.filter((c) => c.category === 'calendar');
    expect(cals.length, '同品类两个连接器并存').toBeGreaterThanOrEqual(2);
    expect(cals.filter((c) => c.active).length, '恰一个 active').toBe(1);

    // 显式 activate 另一个 → 槽位移交。
    await request.post(`${BACKEND}/api/admin/connectors/${b}/activate`, { headers: { 'X-Csrftoken': csrf }, data: {} });
    const after = (await listConnectors(request)).filter((c) => c.category === 'calendar');
    expect(after.find((c) => c.id === b)?.active, 'activate 后 b 成 active').toBe(true);
    expect(after.find((c) => c.id === a)?.active, 'a 退为 inactive').toBe(false);

    // dep-gating 仍开（至少一个 active connected）。
    const cap = await findCapability(request, csrf, 'calendar.book');
    expect(cap?.dependency?.connected, '有 active connected → 仍解闸').toBe(true);
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
  request: APIRequestContext, csrf: string, spec: string, binding: string,
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/connectors`, {
    headers: { 'X-Csrftoken': csrf }, data: { spec, binding },
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

// armMockStatus —— 让 gcal mock 下一次某 op 返指定 HTTP status（429 限流等）。
async function armMockStatus(request: APIRequestContext, op: string, status: number): Promise<void> {
  await request.post(`${MOCK}/__mock/gcal/fail`, { data: { op, status } });
}

// diagListBusy —— 直打 runtime（避开 LLM），干净断降级形状。
async function diagListBusy(
  request: APIRequestContext, id: string,
): Promise<{ status: number; body: unknown }> {
  const res = await request.post(`${BACKEND}/internal/diag/connector/${id}/list-busy`, {
    data: { time_min: '2030-01-01T00:00:00Z', time_max: '2030-01-02T00:00:00Z' },
  });
  return { status: res.status(), body: await res.json() };
}
