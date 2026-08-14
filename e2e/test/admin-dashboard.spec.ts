// admin-dashboard.spec.ts —— admin dashboard KPI cards + sparkline + jump links.
//
// 用户故事：
//   1. owner 登录 → dashboard 是默认 landing
//   2. 4 KPI cards 显示数据 (entries / unprocessed / codes / requests)
//   3. sparkline SVG 渲染 14 天曲线
//   4. "needs your hand" section 渲染
//   5. jump 链接 → 点击跳到对应 admin section

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, clearAIProviderKey, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'dash-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'dashowner',
  fullName: 'Dash Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin dashboard', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('dashboard is default landing after login',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByTestId('dashboard')).toBeVisible({ timeout: 5_000 });
    });

  test('4 KPI cards visible with real data',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByTestId('kpi-entries')).toBeVisible();
      await expect(adminPage.getByTestId('kpi-unprocessed')).toBeVisible();
      await expect(adminPage.getByTestId('kpi-codes live')).toBeVisible();
      await expect(adminPage.getByTestId('kpi-requests')).toBeVisible();
    });

  test('sparkline SVG renders',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      // Scope by aria-label — multiple sparklines now coexist on the
      // dashboard (corpus pulse + ingest "entries per day"), so a bare
      // getByTestId('sparkline') would fail strict mode with 2 matches.
      await expect(adminPage.getByRole('img', { name: 'corpus pulse · 14d' }))
        .toBeVisible({ timeout: 5_000 });
    });

  test('jump links → click "raw" → navigate to admin raw',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      const jumpLink = adminPage.getByTestId('dashboard-jump-raw');
      if (await jumpLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await jumpLink.click();
        await adminPage.waitForURL('**/admin/raw', { timeout: 5_000 });
      }
    });

  test('"needs your hand" → all zero → nothing pending',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      const pending = adminPage.getByTestId('needs-hand');
      await expect(pending).toBeVisible();
    });

  // F-A-24 —— 这台实例没有可用的 AI provider:每一个访客的第一句话都被 503 挡回去
  // (「This page doesn't have an AI provider set up yet.」),而 owner 这边**什么都看不到** ——
  // 没有横幅、没有待办,/admin/api-mcp 那张表单只是空着,跟"还没配过"长得一模一样。
  // 一次升级就能把 owner 打到这个状态(旧的四列还在库里,新的地板只读 provider 本子),
  // 而访客一个接一个被赶走,owner 毫不知情。
  //
  // 迁移那一半这个仓库做不了(没有迁移器,旧列也已经不在 schema.sql 里),但**说出来**这一半
  // 是必须的,而且它不挑原因:只要这台实例答不了访客,dashboard 就得当面讲。
  test('the dashboard says out loud that no AI provider is usable (F-A-24)',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      // 这个状态得**开出来**:claim 总会种一条可用的 provider,而 F-A-24 说的正是一台
      // 曾经能答、后来答不了的实例。清掉 key = 每一个访客的第一句话都会被 503 挡回去。
      await clearAIProviderKey(request, { email: OWNER.email, password: OWNER.password });
      await request.dispose();
      await assertProviderOutageAnnounced(adminPage);
    });

  // F-E-2 —— JOBS · ACTIVE LOOP 那一格里的东西都不跟状态动:TOP MATCH 是 `JobsTopMatch()`
  // 无条件渲染的一句"register sources to start matching",而 SHORTLIST 底下那个 `0` 是 JSX 字面量。
  // 于是这块面板对每一个 owner、在每一个时刻、说同样的话 —— 包括源已经注册好、池子里躺着工作的时候。
  //
  // 正确的那句话产品里已经有了:/admin/listings 在同样的状态下写的是"源有了,去 fetch",还点了名要跑
  // 哪个命令。所以这不是缺一句文案,是两句里挑错了一句(而且根本没在挑)。
  //
  // 这条用例驱三个真状态,断言这一格每次说的都不一样。
  test('the jobs panel changes with the state it claims to describe (F-E-2)',
    async ({ playwright, adminPage }) => {
      await assertJobsPanelFollowsState(playwright, adminPage);
    });

  // UX-41 —— CORPUS PULSE 卡右上角那句 `↑ corpus active` 曾是一个**无条件**的 span：
  // 朱红、醒目、占着"这张图给我的结论"那个位置，而它跟图里的数一条关系都没有。
  // 语料 14 天一条没进的实例上，它照样说 active。
  //
  // 这条用例驱的正是那个状态：这台实例的 pulse 是空的（seed 的那条 wiki 不落在 14 天窗口里
  // 也没关系 —— 断言问的不是"必须说 quiet"，而是**这两句话不能同时对同一份数据成立**）。
  // 判据是**那句话和那条线必须说同一件事**，两个方向都钉住。
  //
  // 第一版写成「必须等于 `nothing new in 14d`」，那是把当时那台实例的状态**当成了判据**：
  // 这个文件里别的用例往语料里写东西，窗口于是不再是平的，产品如实说 `↑ 2 new in 14d`，
  // 而这条用例红了 —— 红的是它自己的前提，不是产品。这种断言只能在一个特定的实例状态下成立，
  // 而它守的那条不变量跟状态无关：**图里有峰就该说有，没峰就该说没有。**
  test('the pulse verdict and the line it sits on say the same thing (UX-41)',
    async ({ adminPage }) => { await assertPulseVerdictMatchesLine(adminPage); });

  // UX-42 —— y 轴刻度是 `max / round(max/2) / 0`。语料刚起步时 `max` 很小，
  // `round(1/2)` 又回到 1，于是三格读作 `1 … 1 … 0`：同一个刻度出现两次。
  // 一个重复的刻度比没有刻度更糟 —— 它让人以为自己看错了，而这正是图最需要被读懂的时候。
  // 这台实例的语料就在那个量级，所以这条断言驱的是真状态。
  test('the sparkline never prints the same y tick twice (UX-42)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      const axis = adminPage.getByTestId('sparkline-axis').first();
      await expect(axis).toBeVisible({ timeout: 5_000 });
      const ticks = (await axis.innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
      expect(new Set(ticks).size, `y ticks are ${ticks.join(' / ')}`).toBe(ticks.length);
    });
});

// assertPulseVerdictMatchesLine —— 判据是**跨面一致**，这正是本模块的透镜。
//
// 侧栏那条 rail 报 7 天新增，卡片那句话报 14 天。7 天是 14 天的**子集**，所以有一条
// 不依赖任何实例状态的不变量：**rail 说 7 天里有 N>0 条，14 天就不可能"什么都没有"。**
//
// 走过两条错路，都记在这里：
//  ① 第一版写死「必须等于 `nothing new in 14d`」—— 那是把当时那台实例的状态当成了判据，
//     同文件别的用例往语料里写东西，它就红了，红的是自己的前提。
//  ② 第二版拿 y 轴顶格当"单日峰值"—— 而 `Sparkline.tsx:41` 是 `Math.max(...data, 1)`：
//     全零的窗口也会印 `1`（不然轴的高度是 0，画不出来）。**顶格是刻度，不是数据**，
//     用它推"有没有新增"必然错。判据要读**真正报这个量的那个元素**。
async function assertPulseVerdictMatchesLine(page: Page): Promise<void> {
  await gotoAdminSection(page, 'dashboard');
  const verdict = page.getByTestId('pulse-verdict');
  await expect(verdict).toBeVisible({ timeout: 5_000 });
  const rail = page.getByTestId('pulse-rail-delta');
  await expect(rail).toBeVisible({ timeout: 5_000 });

  // 先取文本再判断 —— `.not.toContainText` 在元素还没出现时也算通过
  // （[[negated-assertion-passes-while-absent]]）。
  const railText = (await rail.innerText()).trim();
  const said = (await verdict.innerText()).trim();
  const inSevenDays = Number(/([+-]?\d+)\s*in 7d/.exec(railText)?.[1] ?? '0');
  const claimsNew = /(\d+)\s+new in 14d/.exec(said);

  expect(
    claimsNew !== null || inSevenDays <= 0,
    `the rail says "${railText}" and the card says "${said}" — 7d is inside 14d`,
  ).toBe(true);
  expect(
    Number(claimsNew?.[1] ?? '1') > 0,
    `"${said}" claims activity but names zero entries`,
  ).toBe(true);
}

async function assertProviderOutageAnnounced(page: Page): Promise<void> {
  await gotoAdminSection(page, 'dashboard');
  // adminPage 登录时就已经落在 dashboard 上,那一刻 key 还在;dashboard 只在挂载时拉一次,
  // 所以必须重新加载一次文档,否则断言看的是清 key 之前的那份数据。
  await page.reload();
  await expect(
    page.getByTestId('needs-hand'),
    '答不了访客是第一等大事,它必须出现在 needs your hand 里',
  ).toContainText(/ai provider/i, { timeout: 10_000 });
  await expect(page.getByTestId('dashboard-jump-ai'), '还要给一条能走过去的路').toBeVisible();
}

async function assertJobsPanelFollowsState(playwright: Playwright, adminPage: Page): Promise<void> {
  {
      const request = await playwright.request.newContext();
      const { token, sid } = await jobsSession(request);

      // ① 一个源都没有 —— 这时候"去注册源"才是对的。用页面上现有的文字断言,
      // 而不是等一个还不存在的 testid:后者红起来只说明"没这个元素",说不出那句话错在哪。
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByText(/register sources/i)).toBeVisible({ timeout: 5_000 });

      // ② 源注册了,池子还空 —— 这时候再说"去注册源",就是在让 owner 去做已经做完的事。
      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Dash Board', config: { company: 'airbnb' },
      });
      await adminPage.reload();
      await expect(adminPage.getByTestId('dashboard')).toBeVisible({ timeout: 5_000 });
      await expect(
        adminPage.getByText(/register sources/i),
        '源已经在了,不许再把"没有源"当成原因',
      ).toHaveCount(0);
      await expect(
        adminPage.getByTestId('dash-jobs-panel'),
        '缺的是 fetch,那就说 fetch —— /admin/listings 在同样的状态下已经这么说了',
      ).toContainText(/fetch/i);

      // ③ 池子里有工作了 —— TOP MATCH 该指着其中一个,而不是继续讲怎么开始。
      const { jobs } = await jobsFetchNew(request, token, sid, src.id);
      expect(jobs.length, 'mock job board returned 0 jobs').toBeGreaterThan(0);
      await adminPage.reload();
      // 先等这个数落定 —— 它就是"池子拉回来了"的确切信号。
      // 上一版直接读 head,读到的是 "reading the pool…" 那个加载占位:一个只是在跟自己赛跑的红。
      // 顺带这条也是断言本身:那个数上一版是写死的 `0`,池子非空时它必须跟着动。
      await expect(
        adminPage.getByTestId('dash-pool-count'),
        '池子那个数必须是数出来的',
      ).toHaveText(String(jobs.length), { timeout: 10_000 });

      // 不钉顺序(池子的排序不归这条用例管),钉的是:报出来的那条必须真的在池子里。
      const headText = (await adminPage.getByTestId('dash-pool-head').innerText()).trim();
      expect(
        jobs.map((j) => `${j.title} · ${j.company}`),
        '池子里有东西了,就报池子里真有的那一条',
      ).toContain(headText);
      await request.dispose();
  }
}

async function jobsSession(
  request: APIRequestContext,
): Promise<{ token: string; sid: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'dash-jobs');
  return { token, sid: await initMCP(request, token) };
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'dash-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'dash intro.', title: 'Dash Intro',
  });
  await createCode(request, csrf, {
    code: 'DASH-001', label: 'Dashboard test',
  });
  await request.dispose();
}
