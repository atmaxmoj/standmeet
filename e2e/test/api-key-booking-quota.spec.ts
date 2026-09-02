// api-key-booking-quota.spec.ts -- F-B-11 star-star: **an outward key booking meetings
// must also have a limit.**
//
// Caught while driving booking-book check 7 in prod (2026-08-20): one outward key booked
// four meetings back to back, all 200, and four real meetings really appeared on real
// Google. Every other gate in that same run was in place (working hours, busy conflicts,
// disabled tools, revocation) -- only the quota slot was empty.
//
// Reading the mechanism found the line: quota is declared **per code**
// (`mcpplugin.QuotaDecl{ConfigKey:"max_bookings", CodeField:"code_id"}`), but the key path
// is wired up with an empty `codeOverlay{}` (no code) -- on this surface **there is no
// countable subject**. So the fix isn't adding one more check; it's binding quota to the
// subject this path actually has.
//
// The criterion lands in two places, both required:
//   1. the product **says** it refused (the receipt is a readable message, not a 500,
//      and not just another 200);
//   2. **the calendar doesn't gain that meeting**
//      ([[receipt-check-belongs-next-to-the-action]]: don't take its word, go look outside).
// Plus a reverse check: a key with no limit set must not therefore end up allowed zero
// bookings -- otherwise a "reject everything" implementation could also turn this green
// ([[assertion-that-cannot-fail]]).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { getMockEvents } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface MintResp { id: string; prefix: string; secret: string }
interface BookWire { ok?: boolean; conflict?: string; event_id?: string }
interface ToolEnvelope { result?: BookWire; reason?: string; detail?: string }

// KEY_LIMIT -- how many bookings this key is allowed. 2, not 1: with 1 you can't tell
// "rejects on the first try" apart from "counts correctly".
const KEY_LIMIT = 2;

test.describe.serial('F-B-11 · an outward key books under a limit, not without one', () => {
  let seed: BaseSeed;
  let roleID = '';
  let token = '';
  let sid = '';

  test.beforeAll(async ({ playwright }) => {
    // This setup does claim + login + store credentials + a mock OAuth round trip +
    // create skill/role/code + start MCP; under full serial load it exceeds the default
    // 30s, and what gets reported then is "hook timeout" -- unrelated to the product.
    test.setTimeout(150_000);
    seed = await seedOwnerGCalConnected(playwright, {
      allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      min_lead_days: 1,
    });
    // Reuse the role chain (skill -> role -> code) from the code-issuing fixture; the key
    // only needs its role.
    const code = await issueCodeWithSkills(seed.request, seed.csrf, {
      granted_skills: ['calendar.book'],
    });
    roleID = code.assumed_role_id;
    token = await createAPIToken(seed.request, seed.csrf, 'api-key-quota');
    sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('the key stops at its limit, and the calendar stops with it', async () => {
    const key = await mintKey(
      { seed, token, sid, roleID }, 'limited-key', KEY_LIMIT,
    );
    const before = (await getMockEvents(seed.request)).length;

    const first = await book(seed.request, key, 'quota one', future(3, 14));
    const second = await book(seed.request, key, 'quota two', future(3, 15));
    expect(first.result?.ok, 'the first booking goes through').toBe(true);
    expect(second.result?.ok, 'the second booking goes through').toBe(true);

    const third = await book(seed.request, key, 'quota three', future(3, 16));
    expect(
      third.result?.ok ?? false,
      'the third is refused — the key has a limit and it has been reached',
    ).toBe(false);
    expect(
      JSON.stringify(third),
      'and it is refused in words the caller can act on, not a bare 500',
    ).toMatch(/quota|limit/i);

    const after = await getMockEvents(seed.request);
    expect(
      after.length - before,
      'the calendar is the fact: exactly two events, not three',
    ).toBe(KEY_LIMIT);
  });

  test('a key with no limit set is not thereby limited to zero', async () => {
    const key = await mintKey({ seed, token, sid, roleID }, 'unlimited-key', undefined);
    const res = await book(seed.request, key, 'no limit set', future(4, 14));
    expect(
      res.result?.ok,
      'no limit on the key means unlimited, not none — the omission is not a zero',
    ).toBe(true);
  });
});

// mintKey -- mints an outward key through the owner's own path. `max_bookings` has the
// **same name** as at code-issuing time: it's a field `calendar.book` itself declares,
// and which subject it attaches to is a parameter (`capconfig/scope.go`).
interface OwnerPath { seed: BaseSeed; token: string; sid: string; roleID: string }

async function mintKey(
  p: OwnerPath, label: string, maxBookings?: number,
): Promise<string> {
  const args: Record<string, unknown> = { label, assumed_role_id: p.roleID };
  if (maxBookings !== undefined) args['max_bookings'] = maxBookings;
  const mint = await callTool<MintResp>(p.seed.request, p.token, p.sid, 'api_keys.create', args);
  return mint.secret;
}

async function book(
  request: APIRequestContext, key: string, topic: string, when: string,
): Promise<ToolEnvelope> {
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/calendar_book`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    data: { topic, duration_min: 30, preferred_times: [when] },
  });
  return await res.json() as ToolEnvelope;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
