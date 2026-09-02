// job-fetch-cross-source-dedup.spec.ts -- J.6c: cross-source dedup.
// When the same job is returned by two of the owner's sources at once (the JBA aggregate +
// a self-registered Greenhouse), fetch_new must surface only one.
//
// Setup: register Greenhouse "betalabs" first (fixture returns 2 jobs, the first with
// URL = https://boards.greenhouse.io/betalabs/jobs/4001); then register JBA with the
// default filter; the JBA chunk fixture has 5 entries, including one with the same URL
// (acme/beta/...). fetch_new pulls everything -> JBA 5 + GH 2 = 7 raw; canonical URL dedup
// drops 1 (4001); surface = 6.

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

      // Greenhouse first -- the source registered first fetches first, so dedup keeps whichever it sees first.
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
      // raw = 2 (GH) + 5 (JBA) = 7; overlap = 1 (URL = OVERLAP_URL); surface = 6.
      expect(fetched.jobs).toHaveLength(6);

      // **Asking again must still return 6.** The pool is written to per-source -- the
      // duplicate sits in the pool twice, it just used to be invisible in the receipt.
      // F-E-29 changed the receipt to be grown from the pool, so if cross-source dedup
      // doesn't also apply on the pool side, the second ask would surface 7: fixing one bug
      // must not drop an invariant that was already being guarded.
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

      // **Both surfaces must be the same board.** When the count the owner asked about in
      // Claude doesn't match what they see opening /admin/listings, nothing tells you which one is wrong.
      const listings = await request.get('/api/admin/listings/', {
        headers: { 'X-Csrftoken': csrf },
      });
      expect(listings.status(), 'listings 取得到').toBe(200);
      const rows = await listings.json() as { cache_id: string }[];
      expect(
        rows.map((x) => x.cache_id).sort(),
        '面板那一面跟 MCP 那一面是同一块板子',
      ).toEqual(again.jobs.map((j) => j.cache_id).sort());

      // The OVERLAP_URL entry that survives is the Greenhouse version (registered first wins).
      const overlap = fetched.jobs.filter((j) => j.url === OVERLAP_URL);
      expect(overlap).toHaveLength(1);
      expect(overlap[0]?.title).toBe('Backend Engineer (Go)');
      // company_name comes from the Greenhouse entry; the JBA fixture also happens to say
      // "beta-labs", and so does GH. The two agreeing is coincidental; this only asserts the
      // survivor is the GH entry.
      expect(overlap[0]?.company).toBe('beta-labs');

      // **Dedup needs a receipt** (F-E-19). Judging "did cross-source dedup actually happen"
      // used to be possible only through arithmetic like 6 < 2+5, and a conclusion reached
      // by arithmetic doesn't count as driven through -- in the real environment, that 6-job
      // gap between 435 and 441 was exactly this unexplainable. Now the product states it
      // directly: seen/pooled per source, plus how many were dropped cross-source.
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
      // sum of seen - cross-source dropped = the count shown on screen. This line locks the
      // three numbers together, so under- or over-reporting any one of them fails red.
      expect((gh?.seen ?? 0) + (jba?.seen ?? 0) - (fetched.cross_source_dropped ?? 0))
        .toBe(fetched.jobs.length);
    });
});
