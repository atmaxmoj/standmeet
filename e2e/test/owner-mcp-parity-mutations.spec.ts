// owner-mcp-parity-mutations.spec.ts —— 【对外】facade-parity 付清后新增的 owner-MCP **写**
// 工具的功能守护(真 roundtrip:写→回读反映)。每条证 binding 真 unmarshal→usecase→marshal
// 且副作用落库。
//
// 覆盖: ip_bans.{add,remove} · domains.{add,remove} · codes.{add_denial,remove_denial,
// list_denials} · account.set_full_name · byoai.set · capability_config.{set,get} · page.{put,
// set_public_url} · corpus_get_entry(写 raw_dump 后回读) · capabilities.{set_enabled,delete}

import { test, expect } from '@/fixtures/test';

import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'parity-mut@example.com', password: 'correct-horse-battery-staple',
  handle: 'paritymut', fullName: 'Parity Mut Owner',
};

let token = '';
let sid = '';
let codeID = '';

async function setup(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'mut-role', description: 'role for parity-mut spec', corpus_uris: ['wiki://**'],
  });
  token = await createAPIToken(request, csrf, 'parity-mut');
  sid = await initMCP(request, token);
  const made = await callTool<{ code_id: string }>(request, token, sid, 'codes.create', {
    code: 'MUT-001', label: 'MUT', assumed_role_id: role.id,
  });
  codeID = made.code_id;
  await request.dispose();
}

async function run(
  playwright: Playwright, fn: (r: APIRequestContext) => Promise<void>,
): Promise<void> {
  const request = await playwright.request.newContext();
  await fn(request);
  await request.dispose();
}

async function checkIPBans(r: APIRequestContext): Promise<void> {
  const added = await callTool<{ id: string; ip: string }>(
    r, token, sid, 'ip_bans.add', { ip: '203.0.113.7' });
  expect(added.ip, 'ip_bans.add echoes ip').toBe('203.0.113.7');
  const listed = await callTool<Array<{ id: string; ip: string }>>(
    r, token, sid, 'ip_bans.list', {});
  expect(listed.some((b) => b.id === added.id), 'list shows the ban').toBe(true);
  await callTool(r, token, sid, 'ip_bans.remove', { id: added.id });
  const after = await callTool<Array<{ id: string }>>(r, token, sid, 'ip_bans.list', {});
  expect(after.some((b) => b.id === added.id), 'ban gone after remove').toBe(false);
}

async function checkDomains(r: APIRequestContext): Promise<void> {
  await callTool(r, token, sid, 'domains.add', { domain: 'me.example.com' });
  const listed = await callTool<{ domains: string[] }>(r, token, sid, 'domains.list', {});
  expect(listed.domains, 'domains.list shows added').toContain('me.example.com');
  await callTool(r, token, sid, 'domains.remove', { domain: 'me.example.com' });
  const after = await callTool<{ domains: string[] }>(r, token, sid, 'domains.list', {});
  expect(after.domains, 'domain gone after remove').not.toContain('me.example.com');
}

async function checkCodeDenials(r: APIRequestContext): Promise<void> {
  await callTool(r, token, sid, 'codes.add_denial',
    { code_id: codeID, kind: 'capability', target_id: 'calendar.book' });
  const denials = await callTool<{ capability_ids: string[] }>(
    r, token, sid, 'codes.list_denials', { code_id: codeID });
  expect(denials.capability_ids, 'denial added').toContain('calendar.book');
  await callTool(r, token, sid, 'codes.remove_denial',
    { code_id: codeID, kind: 'capability', target_id: 'calendar.book' });
  const after = await callTool<{ capability_ids: string[] }>(
    r, token, sid, 'codes.list_denials', { code_id: codeID });
  expect(after.capability_ids, 'denial removed').not.toContain('calendar.book');
}

async function checkAccountAndByoai(r: APIRequestContext): Promise<void> {
  const named = await callTool<{ full_name: string }>(
    r, token, sid, 'account.set_full_name', { full_name: 'Renamed Owner' });
  expect(named.full_name, 'set_full_name echoes').toBe('Renamed Owner');
  // me 回 {owner, settings}（admin 的 GET /me 一直是这个信封）——迁移前 MCP 的 me 是
  // 手拼字符串出来的四字段 JSON，连转义都没有。
  const me = await callTool<{ owner: { full_name: string } }>(r, token, sid, 'me', {});
  expect(me.owner.full_name, 'me reflects rename').toBe('Renamed Owner');

  // byoai.set 回的是**整片 settings**（ai + byoai）——admin 一直是这个信封，
  // 收口接手后两个面同一份，前端可以直接 swap 进缓存。
  const settings = await callTool<{
    ai: { provider: string; endpoint: string; model: string };
    byoai: { enabled: boolean; providers: string[] };
  }>(r, token, sid, 'byoai.set', {
    enabled: true, providers: ['deepseek'], blurb: 'bring key',
  });
  expect(settings.byoai.enabled, 'byoai enabled').toBe(true);
  expect(settings.byoai.providers, 'byoai providers saved').toContain('deepseek');
  // 迁移前这条写路径回的那份漏了 ai.endpoint / ai.model，swap 一次就把它们抹空。
  expect(settings.ai, 'ai slice comes back whole').toHaveProperty('endpoint');
  expect(settings.ai, 'ai slice comes back whole').toHaveProperty('model');
}

// 预约策略是 booker **自己声明**的配置，经通用的 capability_config 口读写 ——
// 不再有 booking.get_policy / booking.set_policy 这种按能力名写死的工具。
// 值和默认值都来自声明，沙箱经 capconfig.get 读同一份（以前 host 和沙箱各有一份，飘了）。
async function checkCapabilityConfig(r: APIRequestContext): Promise<void> {
  const BOOKER = 'calendar.book';
  const listed = await callTool<{ capabilities: string[] }>(
    r, token, sid, 'capability_config.list', {});
  expect(listed.capabilities, 'booker declares settings').toContain(BOOKER);

  await callTool(r, token, sid, 'capability_config.set', {
    capability_id: BOOKER, values: { working_hours_start: '10:00' },
  });
  const cfg = await callTool<{ fields: { key: string; value: unknown; overridden: boolean }[] }>(
    r, token, sid, 'capability_config.get', { capability_id: BOOKER });
  const start = cfg.fields.find((f) => f.key === 'working_hours_start')!;
  expect(start.value, 'config reflects the write').toBe('10:00');
  expect(start.overridden, 'and is marked as owner-set').toBe(true);

  // 没设过的字段回声明里的默认值，并且标着 overridden=false。
  const end = cfg.fields.find((f) => f.key === 'working_hours_end')!;
  expect(end.value, 'untouched field falls back to the declared default').toBe('18:00');
  expect(end.overridden).toBe(false);
}

async function checkPage(r: APIRequestContext): Promise<void> {
  const before = await callTool<Record<string, unknown>>(r, token, sid, 'page.get', {});
  const saved = await callTool<Record<string, unknown>>(r, token, sid, 'page.put', before);
  expect(saved && typeof saved === 'object', 'page.put returns saved content').toBe(true);
  const url = await callTool<{ public_url: string }>(
    r, token, sid, 'page.set_public_url', { public_url: 'https://me.example.com' });
  expect(url.public_url, 'set_public_url persists').toBe('https://me.example.com');
}

async function checkCorpusGet(r: APIRequestContext): Promise<void> {
  const dumped = await callTool<{ raw_id: string }>(
    r, token, sid, 'raw_dump', { body: 'a private thought about distributed systems', tags: ['sys'] });
  const entry = await callTool<{ genre: string; id: string; body: string }>(
    r, token, sid, 'corpus_get_entry', { genre: 'raw', id: dumped.raw_id });
  expect(entry.id, 'corpus_get_entry returns the entry').toBe(dumped.raw_id);
  expect(entry.body, 'body matches the dump').toContain('distributed systems');
}

async function checkCapabilities(r: APIRequestContext): Promise<void> {
  // 载荷是 {"capabilities": [...]}（admin 已发出去的信封，收口接手后两个面同一份）。
  // 只挑 kind=capability 那种行来开关：connector 行前端锁死、skill 行走 skill 自己的开关。
  const caps = await listCapabilities(r);
  const target = caps.find((c) => c.enabled && c.kind === 'capability')!;
  await callTool(r, token, sid, 'capabilities.set_enabled', { id: target.id, enabled: false });
  const after = await listCapabilities(r);
  expect(after.find((c) => c.id === target.id)?.enabled, 'cap now disabled').toBe(false);

  // skill_create 现在回**完整的 skill**(两个面同一份形状),identifier 字段是 `id`;
  // 迁移前 MCP 单独回 {skill_id,name},admin 回完整 skill —— 两份形状正是要消灭的东西。
  const skill = await callTool<{ id: string }>(
    r, token, sid, 'skill_create', { name: 'doomed-skill', prompt: 'to be deleted' });
  // 删除回 {"ok":true} —— admin 一直是这个形状，收口接手后两个面同一份
  // （迁移前 MCP 单独回 {id, deleted}）。
  const del = await callTool<{ ok: boolean }>(
    r, token, sid, 'capabilities.delete', { id: skill.id });
  expect(del.ok, 'owner skill deleted via capabilities.delete').toBe(true);
}

interface CapabilityRow { id: string; kind: string; enabled: boolean }

async function listCapabilities(r: APIRequestContext): Promise<CapabilityRow[]> {
  const body = await callTool<{ capabilities: CapabilityRow[] }>(
    r, token, sid, 'capabilities.list', {});
  return body.capabilities;
}

test.describe('facade-parity · 新增 owner-MCP 写工具 roundtrip 守护', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('ip_bans add→list→remove roundtrip', ({ playwright }) => run(playwright, checkIPBans));
  test('domains add→list→remove roundtrip', ({ playwright }) => run(playwright, checkDomains));
  test('codes add_denial→list_denials→remove_denial roundtrip',
    ({ playwright }) => run(playwright, checkCodeDenials));
  test('account.set_full_name reflects in me; byoai.set persists',
    ({ playwright }) => run(playwright, checkAccountAndByoai));
  test('capability_config: declared defaults + owner overrides',
    ({ playwright }) => run(playwright, checkCapabilityConfig));
  test('page.put roundtrip + set_public_url persists',
    ({ playwright }) => run(playwright, checkPage));
  test('corpus_get_entry returns a dumped raw entry',
    ({ playwright }) => run(playwright, checkCorpusGet));
  test('capabilities.set_enabled toggles; capabilities.delete removes an owner skill',
    ({ playwright }) => run(playwright, checkCapabilities));
});
