// job-fetch-rss.spec.ts — the GENERIC rss adapter: one adapter, any feed_url.
//
// The long tail of niche boards each expose a standard RSS feed; the generic `rss` kind covers them
// all with no bespoke code — a source just points feed_url at the feed. Here it's pointed at the
// job-board mock's WWR RSS (a real standard RSS feed) and must parse jobs out of it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'rss@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'rssowner',
  fullName: 'RSS Owner',
};

// Any standard RSS feed works; the job-board mock serves one at this path.
const FEED = 'http://external-mock:9000/wwr/categories/remote-product-jobs.rss';

test.describe('generic rss adapter', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('one generic rss source fetches jobs from an arbitrary feed_url', async ({ request }) => {
    const jobs = await fetchViaRSS(request);
    expect(jobs.length, 'the generic rss adapter parsed the standard feed into jobs').toBeGreaterThan(0);
    expect(jobs[0]!.title, 'a parsed job has a title').toBeTruthy();
    expect(jobs[0]!.source_kind, 'attributed to the generic rss kind').toBe('rss');
  });
});

async function fetchViaRSS(request: APIRequestContext): Promise<{ title: string; source_kind: string }[]> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'rss-fetch');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'rss', label: 'A Niche Board', config: { feed_url: FEED },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  return jobs;
}
