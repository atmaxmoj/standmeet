// owner-mcp-parity-reads.spec.ts —— 【对外】facade-parity 付清后新增的 owner-MCP **只读**
// 工具的功能守护。tools/list golden(norm-outward-toolset)只证工具**在**;这条证每个
// 新增只读工具**真能被调起来 + 返回合理形状**(binding 真 unmarshal→usecase→marshal)。
//
// 覆盖: instance.{status,inference_usage,corpus_growth,activity,jobs} · seo.{get_settings,
// stats} · ai_provider.presets · appearance.get_css · page.get · capabilities.list ·
// conversations.{list,ghost_telemetry} · access_requests.list · ip_bans.list · domains.list ·
// connectors.{list,catalog} · booking.get_policy · bookings.list · codes.list · codes.list_members

import { test, expect } from '@/fixtures/test';

import type { APIRequestContext } from '@playwright/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'parity-reads@example.com', password: 'correct-horse-battery-staple',
  handle: 'parityreads', fullName: 'Parity Reads Owner',
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
    name: 'reads-role', description: 'role for parity-reads spec',
    corpus_uris: ['wiki://**'],
  });
  token = await createAPIToken(request, csrf, 'parity-reads');
  sid = await initMCP(request, token);
  const made = await callTool<{ code_id: string }>(request, token, sid, 'codes.create', {
    code: 'READS-001', label: 'READS', assumed_role_id: role.id, max_members: 3,
  });
  codeID = made.code_id;
  await request.dispose();
}

// run —— per-test request lifecycle wrapper (keeps the describe callback small).
async function run(
  playwright: Playwright, fn: (r: APIRequestContext) => Promise<void>,
): Promise<void> {
  const request = await playwright.request.newContext();
  await fn(request);
  await request.dispose();
}

async function checkInstance(r: APIRequestContext): Promise<void> {
  const status = await callTool<{ version: string; uptime_seconds: number; health: unknown[] }>(
    r, token, sid, 'instance.status', {});
  expect(typeof status.version, 'status.version present').toBe('string');
  expect(status.uptime_seconds, 'uptime is a number').toBeGreaterThanOrEqual(0);
  expect(Array.isArray(status.health), 'health is an array').toBe(true);

  const usage = await callTool<{ rows: unknown[]; total: { calls: number } }>(
    r, token, sid, 'instance.inference_usage', {});
  expect(Array.isArray(usage.rows), 'usage.rows array').toBe(true);
  expect(typeof usage.total.calls, 'usage total.calls number').toBe('number');

  const growth = await callTool<{ total: number; series: unknown[] }>(
    r, token, sid, 'instance.corpus_growth', {});
  expect(typeof growth.total, 'growth.total number').toBe('number');
  expect(Array.isArray(growth.series), 'growth.series array').toBe(true);

  const activity = await callTool<{ events: unknown[] }>(r, token, sid, 'instance.activity', {});
  expect(Array.isArray(activity.events), 'activity.events array').toBe(true);

  const jobs = await callTool<{ jobs: unknown[] }>(r, token, sid, 'instance.jobs', {});
  expect(Array.isArray(jobs.jobs), 'jobs.jobs array').toBe(true);
}

async function checkSEO(r: APIRequestContext): Promise<void> {
  const settings = await callTool<{ site_title: string; index_robots: boolean }>(
    r, token, sid, 'seo.get_settings', {});
  expect(typeof settings.site_title, 'site_title string').toBe('string');
  expect(typeof settings.index_robots, 'index_robots bool').toBe('boolean');

  const stats = await callTool<{ wiki: number; outputs: number; writings: number }>(
    r, token, sid, 'seo.stats', {});
  expect(typeof stats.wiki, 'stats.wiki number').toBe('number');
  expect(typeof stats.writings, 'stats.writings number').toBe('number');
}

async function checkOwnerSettings(r: APIRequestContext): Promise<void> {
  const presets = await callTool<Array<{ name: string; base_url: string; key_prefix: string }>>(
    r, token, sid, 'ai_provider.presets', {});
  expect(presets.length, 'at least one preset').toBeGreaterThan(0);
  expect(typeof presets[0]!.name, 'preset.name string').toBe('string');
  expect(typeof presets[0]!.base_url, 'preset.base_url string').toBe('string');

  const css = await callTool<{ css: string }>(r, token, sid, 'appearance.get_css', {});
  expect(typeof css.css, 'css is a string').toBe('string');

  const page = await callTool<Record<string, unknown>>(r, token, sid, 'page.get', {});
  expect(page && typeof page === 'object', 'page.get returns an object').toBe(true);
}

async function checkCapabilities(r: APIRequestContext): Promise<void> {
  const caps = await callTool<Array<{ id: string; kind: string; enabled: boolean }>>(
    r, token, sid, 'capabilities.list', {});
  expect(caps.length, 'at least one capability').toBeGreaterThan(0);
  expect(typeof caps[0]!.id, 'cap.id string').toBe('string');
  expect(typeof caps[0]!.enabled, 'cap.enabled bool').toBe('boolean');
}

async function checkEmptyRegistries(r: APIRequestContext): Promise<void> {
  const convs = await callTool<unknown[]>(r, token, sid, 'conversations.list', {});
  expect(Array.isArray(convs), 'conversations.list array').toBe(true);

  const ghosts = await callTool<unknown[]>(r, token, sid, 'conversations.ghost_telemetry', {});
  expect(Array.isArray(ghosts), 'ghost_telemetry array').toBe(true);

  const reqs = await callTool<unknown[]>(r, token, sid, 'access_requests.list', {});
  expect(Array.isArray(reqs), 'access_requests.list array').toBe(true);

  const bans = await callTool<unknown[]>(r, token, sid, 'ip_bans.list', {});
  expect(Array.isArray(bans), 'ip_bans.list array').toBe(true);

  const domains = await callTool<{ domains: string[] }>(r, token, sid, 'domains.list', {});
  expect(Array.isArray(domains.domains), 'domains.list.domains array').toBe(true);
}

async function checkConnectors(r: APIRequestContext): Promise<void> {
  const list = await callTool<unknown[]>(r, token, sid, 'connectors.list', {});
  expect(Array.isArray(list), 'connectors.list array').toBe(true);

  const catalog = await callTool<Array<{ id: string; category: string; kind: string }>>(
    r, token, sid, 'connectors.catalog', {});
  expect(catalog.length, 'catalog has built-in connectors').toBeGreaterThan(0);
  expect(typeof catalog[0]!.category, 'catalog entry has category').toBe('string');
}

async function checkBooking(r: APIRequestContext): Promise<void> {
  const policy = await callTool<{ working_hours_start: string; allowed_weekdays: string[] }>(
    r, token, sid, 'booking.get_policy', {});
  expect(typeof policy.working_hours_start, 'policy.working_hours_start string').toBe('string');
  expect(Array.isArray(policy.allowed_weekdays), 'policy.allowed_weekdays array').toBe(true);

  const bookings = await callTool<unknown[]>(r, token, sid, 'bookings.list', {});
  expect(Array.isArray(bookings), 'bookings.list array').toBe(true);
}

async function checkCodes(r: APIRequestContext): Promise<void> {
  const codes = await callTool<Array<{ id: string; label: string }>>(
    r, token, sid, 'codes.list', {});
  expect(codes.some((c) => c.id === codeID), 'codes.list contains seeded code').toBe(true);

  const members = await callTool<unknown[]>(
    r, token, sid, 'codes.list_members', { code_id: codeID });
  expect(Array.isArray(members), 'codes.list_members array').toBe(true);
}

test.describe('facade-parity · 新增 owner-MCP 只读工具功能守护', () => {
  test.beforeAll(async ({ playwright }) => { await setup(playwright); });

  test('instance.* observability tools return real shapes',
    ({ playwright }) => run(playwright, checkInstance));
  test('seo.get_settings + seo.stats return settings + published counts',
    ({ playwright }) => run(playwright, checkSEO));
  test('ai_provider.presets + appearance.get_css + page.get return owner settings',
    ({ playwright }) => run(playwright, checkOwnerSettings));
  test('capabilities.list enumerates registry caps with origin + enabled',
    ({ playwright }) => run(playwright, checkCapabilities));
  test('conversations + access_requests + ip_bans + domains return arrays',
    ({ playwright }) => run(playwright, checkEmptyRegistries));
  test('connectors.list empty + catalog has built-ins',
    ({ playwright }) => run(playwright, checkConnectors));
  test('booking.get_policy + bookings.list return the scheduling surface',
    ({ playwright }) => run(playwright, checkBooking));
  test('codes.list shows the seeded code; codes.list_members returns an array',
    ({ playwright }) => run(playwright, checkCodes));
});
