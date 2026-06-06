// job-fetch-cross-source-dedup.spec.ts —— J.6c: 跨源去重。
// 同一岗位被 owner 多源 (JBA 聚合 + 自注册 Greenhouse) 同时返时，
// fetch_new 只 surface 一条。
//
// Setup: register Greenhouse "betalabs" 先 (fixture 2 条 jobs，其中第一条
// URL = https://boards.greenhouse.io/betalabs/jobs/4001)；再 register JBA
// filter = 默认；JBA chunk fixture 含同一条 URL 的 entry (acme/beta/...)
// 5 条。fetch_new 拉全量 → JBA 5 + GH 2 = 7 raw；canonical URL dedup
// 去掉 1 条 (4001)；surface = 6。

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

const OVERLAP_URL = 'https://boards.greenhouse.io/betalabs/jobs/4001';

test.describe('jobs.fetch_new cross-source dedup', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('JBA + Greenhouse 同 URL → 只 1 条 surface (Greenhouse 先注册赢)',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'dedup-spec');
      const sid = await initMCP(request, token);

      // Greenhouse 先 — 先注册的源 fetch 顺序在前，dedup 时第一次见即留下。
      await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse',
        label: 'betalabs GH',
        config: { company: 'betalabs' },
      });
      await jobsRegisterSource(request, token, sid, {
        kind: 'jba',
        label: 'JBA all',
        config: { max_chunks: 1 },
      });

      const fetched = await jobsFetchNew(request, token, sid);
      // raw = 2 (GH) + 5 (JBA) = 7；overlap = 1 (URL = OVERLAP_URL)；
      // surface = 6。
      expect(fetched.jobs).toHaveLength(6);

      // OVERLAP_URL 那条留的是 Greenhouse 版本 (先注册先赢)。
      const overlap = fetched.jobs.filter((j) => j.url === OVERLAP_URL);
      expect(overlap).toHaveLength(1);
      expect(overlap[0]?.title).toBe('Backend Engineer (Go)');
      // company_name 是 Greenhouse 那条的；JBA fixture 写的是 "beta-labs"，
      // GH 写的也是 "beta-labs"。两者一致是巧合；这里只断保留的就是 GH 那条。
      expect(overlap[0]?.company).toBe('beta-labs');
    });
});
