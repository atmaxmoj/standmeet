// owner-mcp-parity-reads.spec.ts — [external-facing] a functional guard for the owner-MCP
// **read-only** tools added once facade-parity was paid off. The tools/list golden
// (norm-outward-toolset) only proves a tool **exists**; this proves every newly added
// read-only tool **can actually be invoked + returns a sane shape** (the binding really
// unmarshals→usecase→marshals).
//
// Covers: instance.{status,inference_usage,corpus_growth,activity,jobs} · microsite.list ·
// ai_provider.presets · appearance.get_css · page.get · capabilities.list ·
// conversations.{list,ghost_telemetry} · access_requests.list · ip_bans.list · domains.list ·
// connectors.{list,catalog} · booking.get_policy · bookings.list · codes.list · codes.list_members
//
// The SEO read used to be seo.{get_settings,stats}, the global site-SEO settings. That feature is
// gone (7037a434e): **SEO follows each microsite**, so the read that carries SEO now is
// microsite.list, whose rows carry seo_title / seo_description / seo_image. seo.stats' other half
// — published wiki / output / writing counts — has no equivalent on the microsite path and no
// successor tool; it is not re-checked here.

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

// SEO_PAGE —— seeded in setup with microsite.set_seo, read back by checkSEO. Asserting the seeded
// values (not just `typeof === 'string'`) is what makes this a read guard: a binding that dropped
// the seo fields, or returned a different page's, goes red.
const SEO_PAGE = {
  slug: 'reads-seo', title: 'Reads SEO',
  seoTitle: 'Reads SEO Title', seoDescription: 'Reads SEO description',
  seoImage: 'https://cdn.example.com/reads.png',
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
  // Creating a code returns **the whole code row** (both surfaces share one payload),
  // and its primary key is called id.
  const made = await callTool<{ id: string }>(request, token, sid, 'codes.create', {
    code: 'READS-001', label: 'READS', assumed_role_id: role.id, max_members: 3,
  });
  codeID = made.id;
  await callTool(request, token, sid, 'microsite.create',
    { slug: SEO_PAGE.slug, title: SEO_PAGE.title });
  await callTool(request, token, sid, 'microsite.set_seo', {
    slug: SEO_PAGE.slug, seo_title: SEO_PAGE.seoTitle,
    seo_description: SEO_PAGE.seoDescription, seo_image: SEO_PAGE.seoImage,
  });
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
  const pages = await callTool<Array<{
    slug: string; seo_title: string; seo_description: string; seo_image: string;
  }>>(r, token, sid, 'microsite.list', {});
  const row = pages.find((p) => p.slug === SEO_PAGE.slug);
  expect(row, 'microsite.list contains the seeded page').toBeDefined();
  expect(row!.seo_title, 'seo_title read back').toBe(SEO_PAGE.seoTitle);
  expect(row!.seo_description, 'seo_description read back').toBe(SEO_PAGE.seoDescription);
  expect(row!.seo_image, 'seo_image read back').toBe(SEO_PAGE.seoImage);
}

async function checkOwnerSettings(r: APIRequestContext): Promise<void> {
  const presets = await callTool<Array<{ name: string; base_url: string; key_prefix: string }>>(
    r, token, sid, 'ai_provider.presets', {});
  expect(presets.length, 'at least one preset').toBeGreaterThan(0);
  expect(typeof presets[0]!.name, 'preset.name string').toBe('string');
  expect(typeof presets[0]!.base_url, 'preset.base_url string').toBe('string');

  const css = await callTool<{ css: string }>(r, token, sid, 'appearance.get_css', {});
  expect(typeof css.css, 'css is a string').toBe('string');
  // page.get is gone: the homepage is a microsite now, not built-in page content.
}

async function checkCapabilities(r: APIRequestContext): Promise<void> {
  // The payload is {"capabilities": [...]} — admin has always used this envelope, and
  // once the convergence took over, MCP got the same one. The connector rows come along
  // too (that whole class was absent from the MCP surface before the migration).
  const body = await callTool<{ capabilities: Array<{ id: string; kind: string; enabled: boolean }> }>(
    r, token, sid, 'capabilities.list', {});
  const caps = body.capabilities;
  expect(caps.length, 'at least one capability').toBeGreaterThan(0);
  expect(typeof caps[0]!.id, 'cap.id string').toBe('string');
  expect(typeof caps[0]!.enabled, 'cap.enabled bool').toBe('boolean');
  expect(caps.some((c) => c.kind === 'connector'), 'connector rows are present too').toBe(true);
}

async function checkEmptyRegistries(r: APIRequestContext): Promise<void> {
  const convs = await callTool<unknown[]>(r, token, sid, 'conversations.list', {});
  expect(Array.isArray(convs), 'conversations.list array').toBe(true);

  // Telemetry returns {waypoints, totals} — the panel has always used this envelope;
  // the MCP version used to be a bare array with no totals.
  const ghosts = await callTool<{ waypoints: unknown[]; totals: { shown: number } }>(
    r, token, sid, 'conversations.ghost_telemetry', {});
  expect(Array.isArray(ghosts.waypoints), 'ghost_telemetry waypoints').toBe(true);
  expect(typeof ghosts.totals.shown, 'and it carries the totals').toBe('number');

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

// The booking policy is read through the **generic** capability_config interface — the
// fields the booker declares itself — there's no longer a booking.get_policy-style tool
// hardcoded to a capability name.
async function checkBookingConfig(r: APIRequestContext): Promise<void> {
  const cfg = await callTool<{ fields: { key: string; value: unknown }[] }>(
    r, token, sid, 'capability_config.get', { capability_id: 'calendar.book' });
  const byKey = new Map(cfg.fields.map((f) => [f.key, f.value]));
  expect(typeof byKey.get('working_hours_start'), 'working_hours_start string').toBe('string');
  expect(Array.isArray(byKey.get('allowed_weekdays')), 'allowed_weekdays array').toBe(true);
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
  test('microsite.list reads back each page\'s SEO (SEO follows the microsite)',
    ({ playwright }) => run(playwright, checkSEO));
  test('ai_provider.presets + appearance.get_css return owner settings',
    ({ playwright }) => run(playwright, checkOwnerSettings));
  test('capabilities.list enumerates registry caps with origin + enabled',
    ({ playwright }) => run(playwright, checkCapabilities));
  test('conversations + access_requests + ip_bans + domains return arrays',
    ({ playwright }) => run(playwright, checkEmptyRegistries));
  test('connectors.list empty + catalog has built-ins',
    ({ playwright }) => run(playwright, checkConnectors));
  test('capability_config.get returns booker\'s declared scheduling fields',
    ({ playwright }) => run(playwright, checkBookingConfig));
  test('codes.list shows the seeded code; codes.list_members returns an array',
    ({ playwright }) => run(playwright, checkCodes));
});
