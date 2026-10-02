// upgrade-per-fiber-storage.spec.ts —— an instance upgraded to per-fiber storage keeps its
// bookings (docs/design/plugin/per-fiber-schema.md, checkpoint 6, T7).
//
// Before the upgrade every booking lived in calendar.book's one schema, mcp_calendar_book. After
// it, a no-bundle visitor's booking lives in mcp_root_<owner>_calendar_book and the owner's reads
// span the owner's fibers — not the old schema. So the boot after the upgrade must move the old
// rows to the owner's root fiber, or every booking made before it disappears from the owner's
// list and its visitor can no longer cancel it.
//
// The old shape is made from a real booking: a visitor books, then the row is put back where the
// old version kept it (no API can create the old shape — it is the old version's own state). The
// backend restarts, and the booking must be listed by the owner and cancellable by its visitor.

import { test, expect } from '@/fixtures/test';

import { createAPIToken } from '@/fixtures/admin';
import { callSessionTool } from '@/fixtures/blocks';
import { rootSchema } from '@/fixtures/bundles';
import { getMockEvents } from '@/fixtures/gcal';
import { seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed } from '@/fixtures/gcal-setup';
import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall, sendAndDrain } from '@/fixtures/mock-llm-script';

const LEGACY = 'mcp_calendar_book';

test.describe.serial('upgrade · bookings stored before per-fiber storage survive it', () => {
  let seed: CodedSeed;
  let root = '';

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(240_000);
    seed = await seedCodeVisitorOnConnectedOwner(playwright, { granted_skills: ['calendar.book'] });
    const tag = await scriptMockToolCall(seed.request, {
      name: 'calendar_book',
      args: { topic: 'booked before the upgrade', duration_min: 30, preferred_times: [futureSlot(7, 14)] },
    });
    await sendAndDrain(seed.request, seed.visitor, `Book 30 minutes next week?${tag}`);
    root = rootSchema(querySQL(`SELECT id FROM owners WHERE handle = '${OWNER.handle}'`), 'calendar.book');
    expect(count(root), 'the booking is in the owner\'s root fiber').toBe(1);
    // Put it back where the old version kept it: the legacy schema, no root fiber schema at all.
    execSQL(`INSERT INTO ${LEGACY}.records (id, collection, doc, created_at) ` +
      `SELECT id, collection, doc, created_at FROM ${root}.records`);
    execSQL(`DROP SCHEMA ${root} CASCADE`);
    expect(count(LEGACY), 'old shape: the booking sits in the legacy schema').toBeGreaterThanOrEqual(1);
    restartBackend();
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the boot moves the old booking to the owner\'s root fiber', () => {
    // ≥ 1, not 1: a reused stack's legacy schema may still hold older specs' rows, and they move too.
    expect(count(root), 'moved to the root fiber').toBeGreaterThanOrEqual(1);
    expect(count(LEGACY), 'nothing left behind in the legacy schema').toBe(0);
  });

  test('the owner lists the booking made before the upgrade', async () => {
    const token = await createAPIToken(seed.request, seed.csrf, 'upgrade-fiber-owner');
    const sid = await initMCP(seed.request, token);
    const listed = await callTool<{ bookings: { visitor_email?: string }[] }>(
      seed.request, token, sid, 'bookings.list', {});
    expect(listed.bookings.map((b) => b.visitor_email)).toContain('rachel@example.com');
  });

  test('its visitor still cancels it', async () => {
    const out = await callSessionTool(seed.request, seed.visitor, 'calendar_cancel', {});
    expect(out).toMatchObject({ cancelled: true });
    expect(await getMockEvents(seed.request), 'the meeting is gone from the calendar').toHaveLength(0);
  });
});

// count — booking documents in one schema.
function count(schema: string): number {
  if (querySQL(`SELECT to_regclass('${schema}.records') IS NOT NULL`) !== 't') return 0;
  return Number(querySQL(`SELECT count(*) FROM ${schema}.records WHERE collection = 'bookings'`));
}

function futureSlot(daysAhead: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
