// job-source-adapters.spec.ts —— roadmap 4.3: my sources are many and reliable.
//
// "Done" (roadmap): a board returning `{}` reports a schema error, not 0 jobs; a 429 mid-walk on
// Workday retries and keeps the pages already read; registering a wrong slug says "not found" at
// once.
//
// Contract:
//   - 4.3.a A Greenhouse body without a `jobs` key fails the source (failed_sources), it does not
//     pool zero jobs. A row with no link is dropped and counted (`skipped.unusable_row`). A 1970
//     placeholder date is no date (no `published_at`).
//   - 4.3.a Workday: a page that answers 429 once is asked again (all 45 rows read); a page that
//     keeps answering 429 keeps the pages before it (20 rows read, `truncated`).
//   - 4.3.b jobs.register_source reads the board once: `probe{count, sample_titles}`. A board that
//     does not exist (404) is refused with a sentence that names the slug as the thing to check.
//   - 4.3.e A pool row carries `salary{min,max,currency}` only when the board states one (Ashby).
// Boards: greenhouse/{emptyobject,oddrows,stripe}, workday/busyco-careers, ashby/paidco.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsFetchNew, mockThrottle, type FetchedJobView } from '@/fixtures/jobs';
import { callTool, callToolOutcome } from '@/fixtures/mcp';

interface Probe { count: number; sample_titles: string[]; error?: string }
interface Salary { min: number; max: number; currency: string; interval?: string }
type Row = FetchedJobView & { salary?: Salary };

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'adapters');
});
test.afterAll(async () => {
  await o.request.dispose();
});

async function register(company: string, kind = 'greenhouse', config?: Record<string, unknown>) {
  return callTool<{ id: string; probe: Probe }>(o.request, o.apiToken, o.sid, 'jobs.register_source', {
    kind, label: `${company} board`, config: config ?? { company },
  });
}

test('4.3.b — registering reads the board once: its count and three titles', async () => {
  const src = await register('stripe');
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, src.id);
  const titles = res.jobs.filter((j) => j.source_id === src.id).map((j) => j.title);
  expect(titles.length, 'presence: the board has jobs').toBeGreaterThan(3);
  // The probe counts what the board lists; the pool can hold fewer (a board's own duplicates).
  const tally = (res.sources ?? []).find((t) => t.source_id === src.id);
  expect(src.probe.count).toBe(tally?.seen);
  expect(src.probe.sample_titles).toHaveLength(3);
  for (const t of src.probe.sample_titles) expect(titles).toContain(t);
});

test('4.3.b — a wrong slug is refused at once, naming the slug', async () => {
  const res = await callToolOutcome(o.request, o.apiToken, o.sid, 'jobs.register_source', {
    kind: 'greenhouse', label: 'Typo', config: { company: 'strpe-typo' },
  });
  expect(res.isError, 'the registration is refused').toBe(true);
  expect(res.text).toMatch(/no such board/i);
  expect(res.text).toMatch(/slug/i);
  const list = await callTool<{ sources: { label: string }[] }>(
    o.request, o.apiToken, o.sid, 'jobs.list_sources', {});
  expect(list.sources.map((s) => s.label), 'presence: the stripe source is listed').toContain('stripe board');
  expect(list.sources.map((s) => s.label), 'the typo is not').not.toContain('Typo');
});

test('4.3.a — a body without jobs is a schema error, not zero jobs', async () => {
  const src = await register('emptyobject');
  expect(src.probe.error, 'the probe already says it').toMatch(/shape/i);
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, src.id);
  const failed = (res.failed_sources ?? []).find((f) => f.source_id === src.id);
  // failed_sources carries the full chain for the owner's AI (F-E-6); the probe carries the sentence.
  expect(failed?.reason).toMatch(/no jobs key: upstream schema mismatch/);
});

test('4.3.a — a row with no link is dropped and counted; a 1970 date is no date', async () => {
  const src = await register('oddrows');
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, src.id);
  const tally = (res.sources ?? []).find((t) => t.source_id === src.id);
  expect(tally?.skipped?.['unusable_row']).toBe(1);
  const rows = res.jobs.filter((j) => j.source_id === src.id);
  expect(rows.map((j) => j.title), 'presence: the good row is pooled').toEqual(['Site Reliability Engineer']);
  expect(rows[0]!.published_at, 'the epoch is a placeholder, not a date').toBeUndefined();
});

test('4.3.a — Workday: a page that stays busy keeps the pages before it', async () => {
  const src = await register('busyco', 'workday', { tenant: 'busyco', wd: '5', site: 'careers' });
  await mockThrottle(o.request, '/workday/wday/cxs/busyco/careers/jobs', 20, 10);
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, src.id);
  expect(res.failed_sources ?? [], 'one busy page does not fail the board').toEqual([]);
  const tally = (res.sources ?? []).find((t) => t.source_id === src.id);
  expect(tally?.read, 'page one kept').toBe(20);
  expect(tally?.truncated).toBe(true);
});

test('4.3.a — Workday: a page busy once is asked again', async () => {
  const src = await register('busyco-again', 'workday', { tenant: 'busyco', wd: '5', site: 'careers' });
  await mockThrottle(o.request, '/workday/wday/cxs/busyco/careers/jobs', 20, 1);
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, src.id);
  const tally = (res.sources ?? []).find((t) => t.source_id === src.id);
  expect(tally?.read, 'all three pages').toBe(45);
  expect(tally?.truncated ?? false).toBe(false);
});

test('4.3.e — salary only where the board states it', async () => {
  const src = await register('paidco', 'ashby');
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, src.id);
  const rows = res.jobs.filter((j) => j.source_id === src.id) as Row[];
  const by = (t: string): Row => rows.find((j) => j.title === t)!;
  expect(by('Staff Platform Engineer').salary).toEqual({
    min: 150000, max: 190000, currency: 'USD', interval: '1 YEAR',
  });
  expect(by('Support Engineer').salary, 'no stated pay, no salary').toBeUndefined();
});
