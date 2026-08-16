// job-fetch-smartrecruiters.spec.ts —— SmartRecruiters 这一档**以前一条 e2e 都没有**
// （夹具 `visa.day1.json` 躺在盘上，mock 里根本没有对应的路由）。
//
// 厂商的规矩是量出来的，不是照文档抄的（2026-08-16 打真 API）：请求 `?limit=200`，
// 响应体里回的是 **`"limit":100`** —— 它**悄悄压到 100**，既不报错也不说自己压过。
// 而 adapter 一次请求就收工、`totalFound` 连解码都没解 —— 于是一家超过 100 个岗位的公司，
// 池子里静默地只有前 100 条，屏幕上跟「这家就这么多岗位」一模一样（F-E-16）。
//
// 137 条 = 20/20/… 不，是 100 + 37 两页：中间那页**满的**，最后一页短的。
// 断言写**准确的条数**，不是「大于 0」——「取到了一些」正是这条 check 要防的那种绿。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'srjobs@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'srjobs',
  fullName: 'SR Jobs Owner',
};

// PAGED_TOTAL —— mock 里那家合成公司的岗位数（`pagedPostings`）。两页：100 + 37。
const PAGED_TOTAL = 137;

test.describe('jobs.fetch_new · smartrecruiters', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('a fixture company surfaces its postings', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'sr-spec');
    const sid = await initMCP(request, token);

    const src = await jobsRegisterSource(request, token, sid, {
      kind: 'smartrecruiters', label: 'Visa SR', config: { company: 'visa' },
    });
    const fetched = await jobsFetchNew(request, token, sid, src.id);
    expect(fetched.failed_sources ?? []).toHaveLength(0);
    expect(fetched.jobs.length, '夹具里有 8 条').toBe(8);
    const first = fetched.jobs[0];
    expect(first?.company, 'company 从 source config 来').toBe('visa');
    expect(first?.url, 'URL 指向厂商的 posting 页').toContain('jobs.smartrecruiters.com/visa/');
  });

  test('a company past the vendor page cap → every page is consumed', async ({ request }) => {
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'sr-paged-spec');
    const sid = await initMCP(request, token);

    const src = await jobsRegisterSource(request, token, sid, {
      kind: 'smartrecruiters', label: 'PagedCo SR', config: { company: 'pagedco' },
    });
    const fetched = await jobsFetchNew(request, token, sid, src.id);
    expect(fetched.failed_sources ?? []).toHaveLength(0);
    expect(fetched.jobs, `全集 ${PAGED_TOTAL} 条，翻页要翻到底`).toHaveLength(PAGED_TOTAL);
    const ids = new Set(fetched.jobs.map((j) => j.external_id));
    expect(ids.size, '每条只出现一次（翻页不许重复取同一页）').toBe(PAGED_TOTAL);
    const titles = fetched.jobs.map((j) => j.title);
    expect(titles, '第二页的条目也要在（停在第一页会缺它）').toContain('Engineer 0136');
    // 账也要对得上：seen == 全集，说明 adapter 交回来的就是全部，不是「屏幕上凑够了」。
    const tally = (fetched.sources ?? []).find((t) => t.source_id === src.id);
    expect(tally?.seen, '这一趟的账要报 137').toBe(PAGED_TOTAL);
  });
});
