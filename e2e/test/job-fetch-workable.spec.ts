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
      // the mock 401s on a bad token → the adapter surfaces it (auth is really enforced upstream).
      await expect(
        jobsFetchNew(request, token, sid, src.id),
        'a bad token must error, not return empty',
      ).rejects.toThrow();
    });
});
