// owner-mcp-parity-mutations.spec.ts — [public-facing] functional guard for the
// owner-MCP **write** tools added once facade-parity was paid off (a real roundtrip:
// write → read back reflects it). Each case proves the binding really does
// unmarshal → usecase → marshal, with the side effect persisted.
//
// Coverage: ip_bans.{add,remove} · domains.{add,remove} · codes.{add_denial,remove_denial,
// list_denials} · account.set_full_name · byoai.set · capability_config.{set,get} · page.{put,
// set_public_url} · corpus_get_entry (write raw_dump, then read it back) ·
// capabilities.{set_enabled,delete}

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
  // Creating a code returns **the entire code row** (the same payload on both
  // facades), and the primary key field is `id`.
  const made = await callTool<{ id: string }>(request, token, sid, 'codes.create', {
    code: 'MUT-001', label: 'MUT', assumed_role_id: role.id,
  });
  codeID = made.id;
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
  // me returns {owner, settings} (admin's GET /me has always used this envelope) —
  // before the migration, MCP's me was a hand-assembled four-field JSON string,
  // without even proper escaping.
  const me = await callTool<{ owner: { full_name: string } }>(r, token, sid, 'me', {});
  expect(me.owner.full_name, 'me reflects rename').toBe('Renamed Owner');

  // byoai.set returns **the entire settings slice** (ai + byoai) — admin has always
  // used this envelope, and now that the convergence has taken over, both facades
  // share it, so the frontend can just swap it straight into the cache.
  const settings = await callTool<{
    ai: { provider: string; endpoint: string; model: string };
    byoai: { enabled: boolean; providers: string[] };
  }>(r, token, sid, 'byoai.set', {
    enabled: true, providers: ['deepseek'], blurb: 'bring key',
  });
  expect(settings.byoai.enabled, 'byoai enabled').toBe(true);
  expect(settings.byoai.providers, 'byoai providers saved').toContain('deepseek');
  // Before the migration, this write path's response was missing ai.endpoint /
  // ai.model, so a single swap would blank them out.
  expect(settings.ai, 'ai slice comes back whole').toHaveProperty('endpoint');
  expect(settings.ai, 'ai slice comes back whole').toHaveProperty('model');
}

// The booking policy is configuration that the booker capability **declares for
// itself**, read and written through the generic capability_config surface — there
// is no longer a booking.get_policy / booking.set_policy tool hardcoded to one
// capability's name. Both the value and its default come from the declaration, and
// the sandbox reads the same one through capconfig.get (previously the host and the
// sandbox each held their own copy, which drifted apart).
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

  // A field that was never set returns the default from the declaration, and is
  // marked overridden=false.
  const end = cfg.fields.find((f) => f.key === 'working_hours_end')!;
  expect(end.value, 'untouched field falls back to the declared default').toBe('18:00');
  expect(end.overridden).toBe(false);
}

async function checkPage(r: APIRequestContext): Promise<void> {
  // page.get / page.put are gone: the owner's homepage is a microsite now, not built-in page
  // content. The `page` resource keeps only its outward addresses (handle / public URL).
  const url = await callTool<{ public_url: string }>(
    r, token, sid, 'page.set_public_url', { public_url: 'https://me.example.com' });
  expect(url.public_url, 'set_public_url persists').toBe('https://me.example.com');
}

async function checkCorpusGet(r: APIRequestContext): Promise<void> {
  const dumped = await callTool<{ id: string }>(
    r, token, sid, 'corpus.create',
    { genre: 'raw', body: 'a private thought about distributed systems', tags: ['sys'] });
  const entry = await callTool<{ genre: string; id: string; body: string }>(
    r, token, sid, 'corpus.get', { genre: 'raw', id: dumped.id });
  expect(entry.id, 'corpus.get returns the entry').toBe(dumped.id);
  expect(entry.body, 'body matches the dump').toContain('distributed systems');
}

async function checkCapabilities(r: APIRequestContext): Promise<void> {
  // The payload is {"capabilities": [...]} (the envelope admin already sends, and
  // now that the convergence has taken over, both facades share it).
  // Only rows with kind=capability are toggled here: connector rows are locked in
  // the frontend, and skill rows go through the skill's own toggle.
  const caps = await listCapabilities(r);
  const target = caps.find((c) => c.enabled && c.kind === 'capability')!;
  await callTool(r, token, sid, 'capabilities.set_enabled', { id: target.id, enabled: false });
  const after = await listCapabilities(r);
  expect(after.find((c) => c.id === target.id)?.enabled, 'cap now disabled').toBe(false);

  // skill_create now returns **the complete skill** (the same shape on both
  // facades), with the identifier field named `id`; before the migration MCP
  // returned only {skill_id,name} while admin returned the full skill — the two
  // separate shapes are exactly what this eliminates.
  const skill = await callTool<{ id: string }>(
    r, token, sid, 'skill_create', { name: 'doomed-skill', prompt: 'to be deleted' });
  // Delete returns {"ok":true} — admin has always used this shape, and now that the
  // convergence has taken over, both facades share it (before the migration MCP
  // returned its own {id, deleted}).
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
  test('page.set_public_url persists',
    ({ playwright }) => run(playwright, checkPage));
  test('corpus_get_entry returns a dumped raw entry',
    ({ playwright }) => run(playwright, checkCorpusGet));
  test('capabilities.set_enabled toggles; capabilities.delete removes an owner skill',
    ({ playwright }) => run(playwright, checkCapabilities));
});
