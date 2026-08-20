// job-fetch-workday-bamboohr.spec.ts —— J.6b: 两个新 ATS direct adapter
// workday (CXS POST) + bamboohr (careers/list GET) 注册 + fetch_new。
// 跟 JBA 那条平行；走真 ATS 而不是聚合 archive。

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

test.describe('jobs.fetch_new (workday + bamboohr) direct ATS adapters', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('workday: POST CXS endpoint → 2 fixture jobs surface',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workday-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workday',
        label: 'Acme Workday',
        config: { tenant: 'acme', wd: '5', site: 'careers' },
      });
      expect(src.kind).toBe('workday');

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.jobs).toHaveLength(2);
      const titles = fetched.jobs.map((j) => j.title);
      expect(titles).toContain('Senior Software Engineer (Backend)');
      expect(titles).toContain('Staff Data Scientist');
    });

  // 真 Workday CXS 每页最多 20 条，超了直接 400（2026-08-16 在两个真租户上量过：
  // `redhat` / `nvidia`，`limit:20` → 200、**`limit:21` → 400**）。adapter 里写死
  // `limit:100`，于是**对真 Workday 一条都取不到**（F-E-15），而这份 spec 一直是绿的 ——
  // 老 mock 对 limit 来者不拒（[[which-path-is-the-green-on]]）。
  //
  // 这条用例同时钉死第二件事：**每一页都要读完**（F-E-16）。45 条 = 20/20/5 三页，
  // 只有跟着 offset 翻到底才凑得齐；停在第一页会得到 20，停在 400 会得到 0。
  // 断言写的是**准确的 45**，不是「大于 0」——「取到了一些」正是这条 check 要防的那种绿。
  //
  // **为什么中间那一页必须是满的**：真 Workday 只在第一页报 `total`，后续页报 0
  // （nvidia 实测）。夹具是 25 条时，第二页恰好是短页，于是「信了后续页的 total」这个 bug
  // 也能凑出正确的 25 —— 绿得毫无信息（[[assertion-that-cannot-fail]]）。
  // 45 条把它逼出来：错的停止条件会停在 40。
  test('workday: 45 postings over three pages → every page is consumed',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'workday-paged-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workday',
        label: 'BigCo Workday',
        config: { tenant: 'bigco', wd: '5', site: 'careers' },
      });

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      expect(fetched.failed_sources ?? [], '取数不该失败：limit 必须落在 vendor 的合法范围内')
        .toHaveLength(0);
      // 数**这一趟这个源新捞的**：回执交的是整个池子窗口（F-E-29），
      // 而同文件前一条用例已经往池子里放过别的岗位。
      const paged = fetched.jobs.filter((j) => j.new && j.source_id === src.id);
      expect(paged, '全集 45 条，翻页要翻到底').toHaveLength(45);
      const ids = new Set(paged.map((j) => j.external_id));
      expect(ids.size, '每条只出现一次（翻页不许重复取同一页）').toBe(45);
      const titles = paged.map((j) => j.title);
      expect(titles, '第二页的条目要在（错的停止条件会停在这之前）')
        .toContain('Staff Engineer, Identity');
      expect(titles, '第三页的条目也要在').toContain('Staff Engineer, Observability');
    });

  test('bamboohr: GET careers/list → 3 fixture jobs (incl null location)',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'bamboohr-spec');
      const sid = await initMCP(request, token);

      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'bamboohr',
        label: 'Zeta BambooHR',
        config: { company: 'zeta' },
      });
      expect(src.kind).toBe('bamboohr');

      const fetched = await jobsFetchNew(request, token, sid, src.id);
      // 这一趟这个源新捞的那 3 条（回执交的是整个池子窗口，F-E-29 —— 上一条
      // 用例的 45 条 workday 还在里面）。
      const mine = fetched.jobs.filter((j) => j.new && j.source_id === src.id);
      expect(mine).toHaveLength(3);
      const titles = mine.map((j) => j.title);
      expect(titles).toContain('Senior Backend Engineer');
      expect(titles).toContain('Product Designer');
      // null location → empty string，不应 crash 或丢条
      expect(titles).toContain('Customer Success Manager');
      // tag 含 department + employmentStatus
      const backend = mine.find((j) => j.title === 'Senior Backend Engineer');
      expect(backend?.tags).toContain('Engineering');
      expect(backend?.tags).toContain('Full-Time');
    });
});
