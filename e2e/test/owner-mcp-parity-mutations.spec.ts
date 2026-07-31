// owner-mcp-parity-mutations.spec.ts —— 【对外】facade-parity 付清后新增的 owner-MCP **写**
// 工具的功能守护(真 roundtrip:写→回读反映)。每条证 binding 真 unmarshal→usecase→marshal
// 且副作用落库。
//
// 覆盖: ip_bans.{add,remove} · domains.{add,remove} · codes.{add_denial,remove_denial,
// list_denials} · account.set_full_name · byoai.set · booking.set_policy · page.{put,
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
  const me = await callTool<{ full_name: string }>(r, token, sid, 'me', {});
  expect(me.full_name, 'me reflects rename').toBe('Renamed Owner');

  const byoai = await callTool<{ enabled: boolean; providers: string[] }>(
    r, token, sid, 'byoai.set', { enabled: true, providers: ['deepseek'], blurb: 'bring key' });
  expect(byoai.enabled, 'byoai enabled').toBe(true);
  expect(byoai.providers, 'byoai providers saved').toContain('deepseek');
}

async function checkBookingPolicy(r: APIRequestContext): Promise<void> {
  await callTool(r, token, sid, 'booking.set_policy', { working_hours_start: '10:00' });
  const policy = await callTool<{ working_hours_start: string }>(
    r, token, sid, 'booking.get_policy', {});
  expect(policy.working_hours_start, 'policy reflects set_policy').toBe('10:00');
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
  test('booking.set_policy reflected by get_policy',
    ({ playwright }) => run(playwright, checkBookingPolicy));
  test('page.put roundtrip + set_public_url persists',
    ({ playwright }) => run(playwright, checkPage));
  test('corpus_get_entry returns a dumped raw entry',
    ({ playwright }) => run(playwright, checkCorpusGet));
  test('capabilities.set_enabled toggles; capabilities.delete removes an owner skill',
    ({ playwright }) => run(playwright, checkCapabilities));
});
