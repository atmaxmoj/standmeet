// job-fetch-workable.spec.ts —— Workable authed SPI adapter (was a v1.1 stub).
//
// owner registers kind=workable {company, api_token}; fetch_new calls
//   GET {base}/spi/v3/accounts/{company}/jobs   Authorization: Bearer {api_token}
// → {jobs:[...]} → surfaces as FetchedJobs. The adapter framework already does authed sources
// (the connector layer's whole point); this wires Workable's real jobs endpoint over its API token.
//
// mock: mock-stack/job-board serveWorkable checks the Bearer token; WORKABLE_BASE_URL points at it.
// RED (before impl): the adapter is a stub that always errors → fetch_new fails → assertions red.

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

const VALID_TOKEN = 'wk-spi-secret-token';

test.describe('jobs.fetch_new (workable) authed SPI', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('register {company, api_token} + fetch_new → authed jobs surface',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workable-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workable',
        label: 'Workable acme',
        config: { company: 'acme', api_token: VALID_TOKEN },
      });
      expect(src.kind).toBe('workable');

      // mock returns 2 fixture jobs for company=acme with a valid Bearer token.
      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.jobs.length).toBe(2);
      const job = fetched.jobs.find((j) => j.title === 'Senior Backend Engineer');
      expect(job, 'the fixture job surfaced').toBeDefined();
      expect(job?.company).toBe('Acme Rockets');
      expect(job?.location).toBe('Remote — EU');
      expect(job?.url).toContain('acme.workable.com');
      expect(job?.tags).toContain('Engineering');
    });

  test('missing api_token → register_source rejected (validate)',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workable-noauth-spec');
      const sid = await initMCP(request, token);

      await expect(
        jobsRegisterSource(request, token, sid, {
          kind: 'workable', label: 'no token', config: { company: 'acme' },
        }),
        'register without api_token must be rejected',
      ).rejects.toThrow();
    });

  test('wrong token → fetch_new surfaces a real upstream auth error (not silent empty)',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workable-badauth-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workable',
        label: 'Workable wrong token',
        config: { company: 'acme', api_token: 'not-the-token' },
      });
      // **The mock now responds the way real Workable actually does**: a bad token →
      // `302 → /oops` (an HTML page), not a well-behaved 401 JSON (verified
      // 2026-08-16 by hitting the real endpoint directly with a fake token).
      // The old mock's 401 was politer than the real world, so this check kept
      // looking correct in CI, while in the real environment the owner received
      // "upstream schema mismatch: invalid character '<'" — pointing them at the
      // wrong next step: go check the adapter, instead of go rotate the token
      // (F-E-17).
      //
      // The criterion is **"must not silently turn into empty"**, not "must throw".
      // The tool was later changed to report failures per-source (one bad source
      // shouldn't drag down the whole fetch), which is the better shape — so what
      // gets asserted is: this run yields no jobs at all, and that source is
      // **named**, with the reason stated clearly.
      //
      // What's counted is **jobs newly entering the pool this run**, not how many
      // rows the receipt lists: the receipt now hands back the whole pool window
      // (F-E-29), and the previous test case in this same file already fetched 2 jobs
      // in with a **good** token. Writing this as `out.jobs.length === 0` would make
      // the assertion go red both when a bad token is truly let through, and when it
      // is correctly rejected — it isn't measuring this run at all (the inverse of
      // [[assertion-that-cannot-fail]]).
      const out = await jobsFetchNew(request, token, sid, src.id);
      expect(
        out.jobs.filter((j) => j.new),
        'a rejected token must not yield jobs',
      ).toHaveLength(0);
      const failed = (out.failed_sources ?? []).find((f) => f.source_id === src.id);
      expect(failed, 'the bad source must be named, not silently dropped').toBeTruthy();
      expect(
        failed?.reason ?? '',
        '要说的是「凭据被拒」，而不是「上游 schema 不匹配」—— 后者把 owner 指向错的下一步',
      ).toMatch(/credential|token|auth/i);
      expect(
        failed?.reason ?? '',
        'schema mismatch 是解析器的问题，不是这一次的问题',
      ).not.toMatch(/schema mismatch/i);
    });
});
