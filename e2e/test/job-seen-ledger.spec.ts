// job-seen-ledger.spec.ts —— roadmap 4.1.a / 4.1.c: a job I saw or discarded does not come back.
//
// "Done" (roadmap): a job discarded from source A does not return through source B the next day.
//
// Contract (fixtures/job-ledger.ts): every pooled posting has a ledger row (job_seen_id on the pool
// row). A later fetch from ANY source drops a posting the ledger already holds; within one fetch the
// cross-source layer stays as it was (job-fetch-cross-source-dedup.spec: both sources pool it, the
// receipt shows one). jobs.discard marks the row discarded.
//
// Boards: Greenhouse "betalabs" (2 jobs, one at OVERLAP_URL) and the JBA chunk (5 entries, one of
// them OVERLAP_URL) — the same pair the cross-source spec uses.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsDiscard, jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { allHistory } from '@/fixtures/job-ledger';

const OVERLAP_URL = 'https://boards.greenhouse.io/betalabs/jobs/4001';

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'seenledger');
});
test.afterAll(async () => { await o.request.dispose(); });

test('4.1.a/c — discarded from Greenhouse, it does not come back through JBA on a later fetch', async () => {
  const gh = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'betalabs GH', config: { company: 'betalabs' },
  });
  const first = await jobsFetchNew(o.request, o.apiToken, o.sid, gh.id);
  const overlap = first.jobs.find((j) => j.url === OVERLAP_URL);
  if (!overlap) throw new Error('precondition: Greenhouse pooled the overlapping posting');
  expect((overlap as { job_seen_id?: string }).job_seen_id, 'the pool row names its ledger row').toBeTruthy();

  await jobsDiscard(o.request, o.apiToken, o.sid, overlap.cache_id);
  const discarded = (await allHistory(o)).find((r) => r.url === OVERLAP_URL);
  expect(discarded?.status, 'the discard is in the ledger').toBe('discarded');

  const jba = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'jba', label: 'JBA all', config: { max_chunks: 1 },
  });
  const later = await jobsFetchNew(o.request, o.apiToken, o.sid, jba.id);
  const tally = (later.sources ?? []).find((t) => t.kind === 'jba');
  expect(tally?.seen, 'presence: JBA offered all five').toBe(5);
  expect(tally?.pooled, 'the one the ledger holds is not pooled again').toBe(4);
  expect(later.jobs.some((j) => j.url === OVERLAP_URL), 'it does not come back').toBe(false);
  expect(later.jobs.filter((j) => j.source_id === jba.id), 'presence: the other four are new').toHaveLength(4);
});

test('4.1.a — seen but never discarded also stays out (the ledger holds what the pool forgot)', async () => {
  // The airbnb board was pooled by setupLoopOwner. A fresh fetch of a second source that offers
  // none of them changes nothing; a re-registered airbnb source (new id, no fingerprints of its
  // own) is the "second source" offering exactly what was seen.
  const again = await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'Airbnb again', config: { company: 'airbnb' },
  });
  const res = await jobsFetchNew(o.request, o.apiToken, o.sid, again.id);
  const tally = (res.sources ?? []).find((t) => t.source_id === again.id);
  expect(tally?.seen, 'presence: the board answered').toBe(o.jobs.length);
  expect(tally?.pooled, 'every one of them was seen before').toBe(0);
  const seen = await allHistory(o, { status: 'seen' });
  expect(o.jobs.every((j) => seen.some((r) => r.url === j.url)), 'all of them are in the ledger as seen').toBe(true);
});
