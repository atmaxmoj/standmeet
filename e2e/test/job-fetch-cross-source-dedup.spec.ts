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

      // **再问一次也还是 6**。池子是按源写进去的 —— 重复那条在池子里躺着两份，
      // 以前只是回执看不见它。F-E-29 把回执改成从池子长出来，如果跨源去重没有
      // 一起作用在池子这一面，第二次问就会冒出 7 条：修一个缺陷不能把另一个
      // 已经守住的不变量放掉。
      const again = await jobsFetchNew(request, token, sid);
      expect(again.jobs, '第二次问，跨源去重照旧成立').toHaveLength(6);
      expect(
        again.jobs.filter((j) => j.url === OVERLAP_URL),
        '重复那条仍然只有一行',
      ).toHaveLength(1);
      expect(
        again.jobs.find((j) => j.url === OVERLAP_URL)?.company,
        '留下的仍然是先入池的那一条（Greenhouse），不是后来的那条',
      ).toBe('beta-labs');

      // **两个面必须是同一块板子**。owner 在 Claude 里问到的，和他打开
      // /admin/listings 看到的，条数对不上时没有一处说得清是谁错了。
      const listings = await request.get('/api/admin/listings/', {
        headers: { 'X-Csrftoken': csrf },
      });
      expect(listings.status(), 'listings 取得到').toBe(200);
      const rows = await listings.json() as { cache_id: string }[];
      expect(
        rows.map((x) => x.cache_id).sort(),
        '面板那一面跟 MCP 那一面是同一块板子',
      ).toEqual(again.jobs.map((j) => j.cache_id).sort());

      // OVERLAP_URL 那条留的是 Greenhouse 版本 (先注册先赢)。
      const overlap = fetched.jobs.filter((j) => j.url === OVERLAP_URL);
      expect(overlap).toHaveLength(1);
      expect(overlap[0]?.title).toBe('Backend Engineer (Go)');
      // company_name 是 Greenhouse 那条的；JBA fixture 写的是 "beta-labs"，
      // GH 写的也是 "beta-labs"。两者一致是巧合；这里只断保留的就是 GH 那条。
      expect(overlap[0]?.company).toBe('beta-labs');

      // **去重要有回执**（F-E-19）。以前判「跨源去重成立了吗」只能靠 6 < 2+5 这种算术，
      // 而算术推出来的结论不算驱过 —— 真实环境里 435 vs 441 那 6 条差额就是这么无从解释的。
      // 现在产品自己说：每个源 seen/pooled，外加跨源挡掉了几条。
      expect(fetched.cross_source_dropped, '同一条 URL 从两个源来，要报「挡掉了 1 条」')
        .toBe(1);
      const tallies = fetched.sources ?? [];
      expect(tallies, '两个源各要有一份账').toHaveLength(2);
      const gh = tallies.find((t) => t.kind === 'greenhouse');
      const jba = tallies.find((t) => t.kind === 'jba');
      expect(gh?.seen, 'greenhouse 上游给了 2 条').toBe(2);
      expect(gh?.pooled, '两条都是新的').toBe(2);
      expect(jba?.seen, 'jba 上游给了 5 条').toBe(5);
      expect(jba?.pooled, '五条对这个源来说都是新的（跨源那一层在池子之后）').toBe(5);
      // seen 之和 - 跨源挡掉 = 屏幕上看到的条数。这一行让三个数互相咬住，
      // 少报或多报任何一个都会红。
      expect((gh?.seen ?? 0) + (jba?.seen ?? 0) - (fetched.cross_source_dropped ?? 0))
        .toBe(fetched.jobs.length);
    });
});
