// retention-assessment.spec.ts —— BLACK BOX, docs/design/job-loop-retention.md §2–3, §6–7.
//
// An assessment is forever unless the owner's AI says `retention: ephemeral`. An ephemeral one
// lives 90 days from its last touch (an annotate write; reads never touch), shows `expiring` in its
// last 7 days, survives while pinned (`keep`), and at expiry leaves a tombstone row that dedup still
// recognises. The daily "retention sweep" clears it; `retention.restore` brings it back; a commit
// makes it forever. Time moves the way the trash specs move it: the clock row is backdated.

import { test, expect } from '@/fixtures/test';

import { commitApplication, setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { allHistory, jobsAnnotate, jobsRecord, type LedgerRow } from '@/fixtures/job-ledger';
import { execSQL } from '@/fixtures/instance';
import { callTool, callToolOutcome } from '@/fixtures/mcp';
import { clearedRecords, sweepRetention } from '@/fixtures/retention';

const DAY = 86_400_000;

type Kept = LedgerRow;

let o: LoopOwner;

const seenID = (n: number): string => {
  const id = (o.jobs[n] as { job_seen_id?: string }).job_seen_id;
  if (!id) throw new Error(`pool row ${n} carries no job_seen_id`);
  return id;
};
const rowOf = async (n: number): Promise<Kept> => {
  const row = (await allHistory(o)).find((r) => r.job_seen_id === seenID(n));
  if (!row) throw new Error(`row ${n} not in history`);
  return row;
};
const backdate = (bundle: string, days: number): void => {
  execSQL(`UPDATE retention_bundles SET last_touched_at = now() - interval '${days} days' WHERE id = '${bundle}'`);
};
const sweep = (): Promise<void> => sweepRetention(o);
const clearedEvents = (): Promise<number> => clearedRecords(o);

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'retention');
  expect(o.jobs.length, 'presence: enough postings').toBeGreaterThanOrEqual(4);
});
test.afterAll(async () => { await o.request.dispose(); });

test('§2 an assessment is forever unless told otherwise; a bad class is refused', async () => {
  await jobsAnnotate(o, seenID(0), { score: 5 });
  const row = await rowOf(0);
  expect(row.retention).toBe('forever');
  expect(row.expires_at, 'forever never expires').toBeNull();
  const bad = await callToolOutcome(o.request, o.apiToken, o.sid, 'jobs.annotate', { job_seen_id: seenID(0), retention: 'sometimes' });
  expect(bad.isError).toBe(true);
  expect(bad.text).toMatch(/forever|ephemeral/);
  expect((await rowOf(0)).retention, 'unchanged').toBe('forever');
});

test('§3 ephemeral expires 90 days after its last touch; reads never touch', async () => {
  await jobsAnnotate(o, seenID(1), { reason: 'ZEBRAKEEP fits', retention: 'ephemeral' });
  let row = await rowOf(1);
  expect(row.retention).toBe('ephemeral');
  expect(row.bundle_id, 'it has a clock').toBeTruthy();
  expect(Date.parse(row.expires_at!) - Date.parse(row.last_touched_at!), 'exactly 90 days').toBe(90 * DAY);

  backdate(row.bundle_id!, 10);
  const before = (await rowOf(1)).last_touched_at;
  await allHistory(o);
  expect((await rowOf(1)).last_touched_at, 'a read is not a touch').toBe(before);

  await jobsAnnotate(o, seenID(1), { score: 6 });
  row = await rowOf(1);
  expect(Date.parse(row.last_touched_at!) - Date.parse(before!), 'a write is').toBeGreaterThan(9 * DAY);
});

test('§3 the last 7 days read expiring', async () => {
  const bundle = (await rowOf(1)).bundle_id!;
  backdate(bundle, 82);
  expect((await rowOf(1)).expiring, '8 days left').toBe(false);
  backdate(bundle, 84);
  expect((await rowOf(1)).expiring, '6 days left').toBe(true);
});

test('§3 a pinned assessment outlives the clock; unpinning restarts it', async () => {
  await jobsAnnotate(o, seenID(2), { reason: 'ZEBRAPIN', retention: 'ephemeral', keep: true });
  const pinned = await rowOf(2);
  expect(pinned.keep).toBe(true);
  backdate(pinned.bundle_id!, 180);
  const records = await clearedEvents();
  await sweep();
  expect(await clearedEvents(), 'the sweep cleared nothing').toBe(records);
  expect((await rowOf(2)).reason, 'kept').toBe('ZEBRAPIN');

  await jobsAnnotate(o, seenID(2), { keep: false });
  const row = await rowOf(2);
  expect(row.keep).toBe(false);
  expect(Date.parse(row.expires_at!) - Date.now(), 'unpin is a touch: 90 days from now').toBeGreaterThan(89 * DAY);
});

test('§3 at expiry the assessment clears to a tombstone, once, with an audit record', async () => {
  const bundle = (await rowOf(1)).bundle_id!;
  const events = await clearedEvents();
  backdate(bundle, 91);
  await sweep();
  await expect.poll(async () => (await rowOf(1)).cleared_at, { timeout: 30_000 }).not.toBeNull();
  const row = await rowOf(1);
  expect(row.reason, 'the assessment is gone').toBeUndefined();
  expect(row.score).toBeUndefined();
  expect(row.company, 'the tombstone keeps the company').toBe(o.jobs[1]!.company);
  expect(row.title).toBe(o.jobs[1]!.title);
  expect(row.status).toBe('seen');
  expect(await clearedEvents(), 'one audit record').toBe(events + 1);

  await sweep();
  expect(await clearedEvents(), 'a second sweep does nothing').toBe(events + 1);
});

test('§3 a cleared row refuses a write; seen again it is known and marked assessed before', async () => {
  const write = await callToolOutcome(o.request, o.apiToken, o.sid, 'jobs.annotate', { job_seen_id: seenID(1), score: 9 });
  expect(write.isError).toBe(true);
  expect(write.text, 'says how to get it back').toMatch(/restore/i);

  const row = await rowOf(1);
  const [again] = await jobsRecord(o, [{ title: row.title, company: row.company, url: row.url }]);
  expect(again!.new, 'dedup survives the clearing').toBe(false);
  expect(again!.assessed_before).toBe(true);
});

test('§3 restore brings the assessment back on a fresh clock', async () => {
  const bundle = (await rowOf(1)).bundle_id!;
  await callTool(o.request, o.apiToken, o.sid, 'retention.restore', { bundle_id: bundle });
  await expect.poll(async () => (await rowOf(1)).reason, { timeout: 30_000 }).toBe('ZEBRAKEEP fits');
  const row = await rowOf(1);
  expect(row.cleared_at).toBeNull();
  expect(row.retention).toBe('ephemeral');
  expect(Date.parse(row.expires_at!) - Date.now()).toBeGreaterThan(89 * DAY);
});

test('§3 committing an ephemeral posting makes its assessment forever', async () => {
  await jobsAnnotate(o, seenID(3), { reason: 'ZEBRASEND', retention: 'ephemeral' });
  expect((await rowOf(3)).retention).toBe('ephemeral');
  await commitApplication(o, 3);
  const row = await rowOf(3);
  expect(row.retention, 'sent out: no TTL').toBe('forever');
  expect(row.expires_at).toBeNull();
  expect(row.reason).toBe('ZEBRASEND');
});
