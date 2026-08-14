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
      //
      // 判据是**「不许静默变成空」**，不是「必须抛」。工具后来改成逐源报告失败
      // （一个源坏了不该把整次抓取一起拖垮），那是更好的形状 —— 于是要断的是：
      // 这一次没有任何岗位，而且那个源被**点名**说清了原因。
      // 只断 `jobs` 为空的话，一个真的静默吞掉 401 的实现也照样过。
      const out = await jobsFetchNew(request, token, sid, src.id);
      expect(out.jobs, 'a 401 upstream must not yield jobs').toHaveLength(0);
      const failed = (out.failed_sources ?? []).find((f) => f.source_id === src.id);
      expect(failed, 'the bad source must be named, not silently dropped').toBeTruthy();
      expect(
        failed?.reason ?? '',
        'the reason must carry the real upstream status, not a generic "could not fetch"',
      ).toMatch(/401|unauthor/i);
    });
});
