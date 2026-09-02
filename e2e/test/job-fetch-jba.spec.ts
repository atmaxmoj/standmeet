// job-fetch-jba.spec.ts —— J.6a: owner registers a "jba" source that goes through the
// JobBoardAggregator chunked archive; fetch_new pulls the manifest + gzip chunk, filters 5
// fixture jobs against the config's title_keywords / location / ats filters, and verifies
// only the matches come back.
//
// JBA fixture: e2e/fixtures/job-boards/jba/{jobs_manifest.json, jobs_chunk_0.json.gz}; the
// mock service serves /jba/data/chunks/{filename} (mock-stack/job-board/main.go serveJBA).
// Backend env JBA_BASE_URL points at the mock.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.describe('jobs.fetch_new (jba) filters chunked archive locally', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('title_keywords + ats config → only matching jobs surface',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'jba-spec');
      const sid = await initMCP(request, token);

      // The fixture chunk holds 5 entries (titles: Senior Go Engineer / Backend Engineer (Go) /
      // Frontend Engineer / Staff Platform Engineer / Data Scientist; ats: 2 Ashby + 2
      // Greenhouse + 1 Lever). filter "go" + ats=Ashby should return exactly 1
      // (Senior Go Engineer @ acme-rockets, Ashby).
      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'jba',
        label: 'JBA Ashby Go',
        config: { title_keywords: ['go'], ats: 'Ashby', max_chunks: 1 },
      });
      expect(src.kind).toBe('jba');

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.jobs).toHaveLength(1);
      const job = fetched.jobs[0];
      expect(job?.title).toBe('Senior Go Engineer');
      expect(job?.company).toBe('acme-rockets');
      expect(job?.url).toBe('https://jobs.ashbyhq.com/acme-rockets/abc-123');
      expect(job?.tags).toContain('Ashby');
    });

  test('empty filter → all 5 fixture jobs surface',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'jba-empty-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'jba',
        label: 'JBA all',
        config: { max_chunks: 1 },
      });
      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.jobs).toHaveLength(5);
    });
});
