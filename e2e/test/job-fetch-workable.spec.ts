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
      // **mock 现在照真 Workable 的样子回**：坏 token → `302 → /oops`（一张 HTML 页），
      // 不是体面的 401 JSON（2026-08-16 用假 token 直接问过真 endpoint）。
      // 老 mock 那个 401 比真实世界客气，于是这条 check 在 CI 上一直看着是对的，
      // 而真环境里 owner 收到的是「upstream schema mismatch: invalid character '<'」——
      // 指向的下一步是错的：去查适配器，而不是去换 token（F-E-17）。
      //
      // 判据是**「不许静默变成空」**，不是「必须抛」。工具后来改成逐源报告失败
      // （一个源坏了不该把整次抓取一起拖垮），那是更好的形状 —— 于是要断的是：
      // 这一次没有任何岗位，而且那个源被**点名**说清了原因。
      //
      // 数**这一趟新进池子的**，不是数回执里有多少行：回执现在交的是整个池子窗口
      // （F-E-29），而同文件前一条用例已经用**好** token 抓过 2 条进去。
      // 写成 `out.jobs.length === 0` 的话，这条断言在坏 token 真的放行时也会红、
      // 在它被正确拒绝时也会红 —— 它量的根本不是这一次（[[assertion-that-cannot-fail]] 的反面）。
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
