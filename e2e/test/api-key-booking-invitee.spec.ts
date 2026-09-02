// api-key-booking-invitee.spec.ts —— F-B-12 ⭐: **a booking made through an external key
// needs a guest too.**
//
// Found while driving booking-book check 7 on prod (2026-08-20): every meeting booked
// through `/api/pub/v1` came back with an empty `invited_email` in the receipt, and opening
// it on Google showed **zero attendees**; a booking made the same day through the chat path
// had the guest attached correctly. What this path produces is a real event on the owner's
// calendar — a meeting with no guest means the owner shows up to an empty room.
//
// **Why the fix isn't "add a tool parameter"**: F-B-6 already ruled on this once — let the
// model fill in the recipient itself, and it will invent one out of the conversation. So the
// invitee **comes only from the session identity**; `calendar_book` doesn't accept a
// `visitor_email` tool arg. On the key path there's no session identity to speak of (the
// caller is someone else's program), and that's exactly the gap: **on whose behalf is this booking made?**
//
// The fix, therefore, is to place it at the **session layer**, not in the tool parameters:
// the caller states who they represent in a request header, and the facade treats that as
// this call's visitor identity — the plugin side changes not one line, and F-B-6's rule still holds.
//
// The criterion lands **outside**: the receipt saying so doesn't count; go check with the
// provider whether this person is actually on the event
// ([[receipt-check-belongs-next-to-the-action]]).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken } from '@/fixtures/admin';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { getMockEvents } from '@/fixtures/gcal';
import { seedOwnerGCalConnected, type BaseSeed } from '@/fixtures/gcal-setup';
import { callTool, initMCP } from '@/fixtures/mcp';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const GUEST = 'programmatic.guest@example.com';

interface MintResp { id: string; prefix: string; secret: string }
interface BookWire { ok?: boolean; invited_email?: string; event_id?: string }
interface ToolEnvelope { result?: BookWire; reason?: string }

test.describe.serial('F-B-12 · a booking made through a key can name its guest', () => {
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
    const token = await createAPIToken(seed.request, seed.csrf, 'api-key-invitee');
    const sid = await initMCP(seed.request, token);
    await callTool(seed.request, token, sid, 'api.open', { capability_id: 'calendar.book' });
    const mint = await callTool<MintResp>(seed.request, token, sid, 'api_keys.create', {
      label: 'invitee-key', assumed_role_id: code.assumed_role_id,
    });
    key = mint.secret;
  });

  test.afterAll(async () => { await seed.request.dispose(); });

  test('the guest the caller names is on the event at the provider', async () => {
    const res = await book(seed.request, key, 'invitee audit', future(6, 14), GUEST);
    expect(res.result?.ok, 'the booking goes through').toBe(true);
    expect(res.result?.invited_email, 'the receipt names who was invited').toBe(GUEST);

    const evs = await getMockEvents(seed.request);
    const mine = evs.find((e) => e.summary.includes('invitee audit'));
    expect(mine, 'the event is at the provider').toBeTruthy();
    expect(
      (mine?.attendees ?? []).map((a) => a.email),
      'and the guest is on it — a receipt that says "invited" while the event has nobody is the '
      + 'defect this guards',
    ).toContain(GUEST);
    expect(
      mine?.send_updates, 'the provider was asked to notify them, not merely to list them',
    ).toBeTruthy();
  });

  test('with nobody named, the receipt says so instead of going quiet', async () => {
    const res = await book(seed.request, key, 'no guest audit', future(6, 16), '');
    expect(res.result?.ok, 'an owner-only hold is still a valid booking').toBe(true);
    expect(
      res.result?.invited_email,
      'and the receipt is explicit that nobody was invited — the caller must be able to tell '
      + 'the two outcomes apart',
    ).toBe('');
  });
});

// book —— books a meeting through the facade. `X-Standmeet-Visitor-Email` states **on whose
// behalf this is booked**: it belongs to the session identity, not to a tool parameter
// (F-B-6: the recipient must not be decided by the model or the payload).
async function book(
  request: APIRequestContext, apiKey: string, topic: string, when: string, guest: string,
): Promise<ToolEnvelope> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
  };
  if (guest !== '') headers['X-Standmeet-Visitor-Email'] = guest;
  const res = await request.fetch(`${BACKEND}/api/pub/v1/tools/calendar_book`, {
    method: 'POST', headers,
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
