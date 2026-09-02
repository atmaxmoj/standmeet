// api-key-query-reads.spec.ts -- F-B-13: **a read must say it is a read.**
//
// Spotted while driving booking-book check 7 (2026-08-20): in `GET /api/pub/v1/tools`,
// `calendar_list_slots`'s `read_only` is **false**, while all four `corpus_*` are true.
// Listing slots is safe and idempotent -- that is exactly why the `QUERY` method exists
// (RFC 10008: a read with a body). A read gets registered as a write, so callers are
// forced to use POST, and the product **answers wrong** on "does this call change anything".
//
// This flag comes from the tool's own MCP `annotations.readOnlyHint`
// (`capreg/binding_tool.go:55`); the booker plugin has never declared it on its read tools.
//
// The pass criterion is not "that flag reads true", it is **that the method actually
// works**: first assert QUERY goes through (that's the capability this flag unlocks),
// then assert QUERY is still rejected on write tools -- otherwise an implementation that
// always returns `read_only:true` would also go green ([[assertion-that-cannot-fail]]).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MintResp { id: string; prefix: string; secret: string }
interface DiscoverBody { tools: Array<{ name: string; read_only: boolean }> }

test.describe.serial('F-B-13 · a safe read is declared as one, and QUERY works on it', () => {
  let seed: BaseSeed;
  let key = '';

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(150_000);
    seed = await seedOwnerGCalConnected(playwright, {
      allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      min_lead_days: 1,
    });
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: ['calendar.book'],
    });
    const token = await createAPIToken(seed.request, seed.csrf, 'api-key-query');
    const sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
    const mint = await callTool<MintResp>(seed.request, token, sid, 'api_keys.create', {
      label: 'query-key', assumed_role_id: code.assumed_role_id,
    });
    key = mint.secret;
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('listing slots says it is read-only; booking says it is not', async () => {
    const res = await seed.request.get(`${BACKEND}/api/pub/v1/tools`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json() as DiscoverBody;
    const flag = (n: string) => body.tools.find((t) => t.name === n)?.read_only;
    expect(flag('calendar_list_slots'), 'listing free slots changes nothing').toBe(true);
    expect(
      flag('calendar_book'), 'booking does change something — the flag must still separate them',
    ).toBe(false);
  });

  test('QUERY reaches the read tool and is still refused on the write tool', async () => {
    const read = await query(seed.request, key, 'calendar_list_slots', {
      from_rfc3339: future(2), until_rfc3339: future(4), duration_min: 30,
    });
    expect(read.status, 'QUERY is what a body-carrying read is for').toBe(200);

    const write = await query(seed.request, key, 'calendar_book', {
      topic: 'should never happen', duration_min: 30, preferred_times: [future(3)],
    });
    expect(
      write.status, 'and a state-changing tool still refuses it — QUERY promises safe + idempotent',
    ).toBe(405);
  });
});

async function query(
  request: APIRequestContext, key: string, name: string, body: unknown,
): Promise<{ status: number }> {
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/${name}`, {
    method: 'QUERY',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    data: body,
  });
  return { status: res.status() };
}

function future(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
}
