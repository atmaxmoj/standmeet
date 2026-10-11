// job-freshness.spec.ts —— roadmap 4.2: I see only fresh, real postings.
//
// "Done" (roadmap): a board's year-old backlog is not "new"; a closed Greenhouse job reads "closed"
// before drafting; a URL-shortener posting is flagged, not dropped; a country-restricted posting is
// flagged.
//
// Contract:
//   - jobs.fetch_new takes `max_age_days`: a posting published longer ago is not pooled; an undated
//     one passes. The tally says `too_old`. (The pool window, since_hours, is unchanged.)
//   - resume.draft's receipt says `liveness: 'open'|'closed'|'unknown'` for its posting — read from
//     the board before drafting. Unknown is not closed.
//   - Pool rows carry `flags` read from the posting: 'shortener' (a bit.ly-style link),
//     'location-restricted' ("US only", "must be located in …"). Flagged postings are kept.
// Board: greenhouse/freshness (dates written as __DAYS_AGO_n__, filled in by the mock).

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsFetchNew, jobsRegisterSource, mockGone, type FetchedJobView } from '@/fixtures/jobs';
import { callTool, callToolMulti } from '@/fixtures/mcp';
import { sampleResumeContent } from '@/fixtures/resume';

type Flagged = FetchedJobView & { flags?: string[] };

let o: LoopOwner;
let fresh: Flagged[] = [];

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'freshness');
});
test.afterAll(async () => {
  await o.request.dispose();
});

test('4.2.a — a year-old posting is not new; an undated one passes', async () => {
  const src = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'Fresh Co', config: { company: 'freshness' },
  });
  const res = await callTool<{ jobs: Flagged[]; sources: { source_id: string; seen: number; pooled: number; too_old: number }[] }>(
    o.request, o.apiToken, o.sid, 'jobs.fetch_new', { source_id: src.id, max_age_days: 30 });
  const tally = res.sources.find((t) => t.source_id === src.id);
  expect(tally?.seen, 'presence: the board offered all four').toBe(4);
  expect(tally?.too_old, 'the 400-day-old one').toBe(1);
  expect(tally?.pooled).toBe(3);
  fresh = res.jobs.filter((j) => j.company === 'Fresh Co');
  expect(fresh.map((j) => j.title).sort()).toEqual(['Backend Engineer', 'Data Engineer', 'Ops Engineer']);
});

test('4.2.c/d — a shortener link and a country restriction are flagged, not dropped', () => {
  const by = (t: string): Flagged => fresh.find((j) => j.title === t)!;
  expect(by('Backend Engineer').flags ?? []).toContain('shortener');
  expect(by('Data Engineer').flags ?? []).toContain('location-restricted');
  expect(by('Ops Engineer').flags ?? [], 'a plain posting has none').toEqual([]);
});

async function draftLiveness(cacheID: string): Promise<string> {
  const parts = await callToolMulti(o.request, o.apiToken, o.sid, 'resume.draft',
    { job_cache_id: cacheID, resume_content: sampleResumeContent() });
  const text = parts.find((p) => p.type === 'text');
  if (!text || text.type !== 'text') throw new Error('resume.draft: no text part');
  return (JSON.parse(text.text) as { liveness: string }).liveness;
}

test('4.2.b — before drafting, the board says whether the posting is still open', async () => {
  // The posting closes on this spec's own board, by path: the mock's day flag is global, and a
  // parallel spec flipping it raced this assertion.
  const closed = fresh.find((j) => j.title === 'Ops Engineer')!;
  expect(await draftLiveness(closed.cache_id), 'still on the board').toBe('open');
  await mockGone(o.request, `/greenhouse/v1/boards/freshness/jobs/${closed.external_id}`);
  expect(await draftLiveness(closed.cache_id), 'gone from the board').toBe('closed');
  const remote = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'remoteok', label: 'RemoteOK', config: {},
  });
  const rok = (await jobsFetchNew(o.request, o.apiToken, o.sid, remote.id)).jobs.find((j) => j.source_id === remote.id)!;
  expect(await draftLiveness(rok.cache_id), 'a board that cannot say is unknown, not closed').toBe('unknown');
});
