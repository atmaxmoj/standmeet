// admin-sources.spec.ts —— admin /sources lists the owner's real job sources
// (#51). Sources are registered via MCP jobs.register_source; the admin section
// is read-only and now fetches GET /api/admin/job-sources/ (was a stub).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';

const OWNER = {
  email: 'sources@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sources',
  fullName: 'Sources Owner',
};
const LABEL = 'Sources Test Board';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sources list', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('empty state when no source is registered',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      await expect(adminPage.getByText(/no sources registered/i)).toBeVisible();
    });

  test('no dead "+board"/"+rss" add buttons — sources are MCP-registered (F-E-1)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      // The old header buttons opened no form and contradicted the page's own copy. Removed —
      // the page directs to the jobs.register_source MCP tool instead.
      await expect(adminPage.getByRole('button', { name: /\+\s*board/i })).toHaveCount(0);
      await expect(adminPage.getByRole('button', { name: /rss|scraper/i })).toHaveCount(0);
      await expect(adminPage.getByText(/jobs\.register_source/i).first()).toBeVisible();
    });

  test('a registered source appears in the list',
    async ({ request, adminPage }) => {
      await seedSource(request);
      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      await expect(adminPage.getByTestId('sources-list')).toBeVisible({ timeout: 5_000 });
      await expect(adminPage.getByText(LABEL)).toBeVisible();
    });
  // 这一页要回答的是「我这个源还活着吗」。**取过但每次都失败**的源，以前跟
  // **从没被碰过**的源印同一句话 `never fetched`（F-E-18，真环境里三行都是这样）。
  // 用一把错 token 的 workable 源制造一次真失败：它注册得成、取数一定失败。
  test('a source that was tried and failed does not read as "never fetched"',
    async ({ request, adminPage }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'sources-failing');
      const sid = await initMCP(request, token);
      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'workable',
        label: 'Failing Board',
        config: { company: 'acme', api_token: 'not-the-token' },
      });
      await jobsFetchNew(request, token, sid, src.id);

      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      const state = adminPage.getByTestId(`source-state-${src.id}`);
      await expect(state).toBeVisible({ timeout: 5_000 });
      const text = await state.innerText();
      // 先取文本再判：元素还没出现时 `.not.toContainText` 也算通过（[[negated-assertion-passes-while-absent]]）。
      expect(text, '试过就不该说「从没取过」').not.toMatch(/never fetched/i);
      expect(text, '要说出上次试过、失败了').toMatch(/failed/i);
      expect(text, '要带上原因，owner 才知道下一步做什么').toMatch(/credential|token/i);
      // **给人看的一句话，不是整条错误链**（UX-77）：链条前面两截是源 uuid 和内部动词，
      // 铺在这一行上会折成三行，而 owner 需要的是最后那半句。完整的链留给 owner 的 AI
      // （`failed_sources[].reason`）和日志。
      expect(text, '不该把源的 uuid 摆在屏幕上').not.toContain(src.id);
      expect(text, '不该出现内部动词').not.toMatch(/fetch source|fetch workable/i);
      expect(text, '不该出现上游 URL').not.toMatch(/https?:\/\//);
    });

  // **一句话覆盖了两种完全不同的处境**（F-E-28，prod 上撞到的）：`fetch/http.go` 把所有
  // 非 2xx 归成同一个 `ErrUpstream`，于是 301（板子搬家了）和 404（根本没有这块板子）
  // 在 `/admin/sources` 上说的是同一句 —— "the board turned the request away — it may have moved"。
  //
  // 对 404 来说那句话是**假的**，而且把 owner 指向了错误的下一步：他会去找新地址，
  // 而实际要做的是改掉拼错的 company slug（或删掉这个源）。整张归类表的纪律写的是
  // 「每一句都指出下一步」—— 这一句对这一类没做到（[[collapsed-error-class-kills-its-own-branch]]）。
  test('a board that does not exist is not reported as one that moved',
    async ({ request, adminPage }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'sources-404');
      const sid = await initMCP(request, token);
      // 替身跟真 Greenhouse 一样：没有这块板子就回 404（真板子当场验过）。
      const src = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Ghost Board', config: { company: 'no-such-company-here' },
      });
      const out = await jobsFetchNew(request, token, sid, src.id);
      expect(
        (out.failed_sources ?? []).map((f) => f.source_id),
        'precondition: 这个源必须真的取失败了，否则下面判的是空气',
      ).toContain(src.id);

      await gotoAdminSection(adminPage, 'sources');
      await adminPage.waitForURL('**/admin/sources', { timeout: 5_000 });
      const state = adminPage.getByTestId(`source-state-${src.id}`);
      await expect(state).toBeVisible({ timeout: 5_000 });
      expectMissingBoardSentence(await state.innerText(), src.id);
    });
});

// expectMissingBoardSentence —— 「这个地址上没有板子」那一行该长什么样。
function expectMissingBoardSentence(text: string, srcID: string): void {
  expect(text, '要说出上次试过、失败了').toMatch(/failed/i);
  expect(
    text,
    '404 不是"搬家了"：板子没搬，它压根不存在。这句话会把 owner 送去找新地址',
  ).not.toMatch(/moved/i);
  expect(
    text,
    '要指出真正的下一步：这个地址上没有板子，去改源的设置',
  ).toMatch(/no such board|doesn't exist|does not exist|check the .*(address|settings|company)/i);
  // 给人看的那一行的纪律照旧（UX-77）。
  expect(text, '不该把源的 uuid 摆在屏幕上').not.toContain(srcID);
  expect(text, '不该出现上游 URL').not.toMatch(/https?:\/\//);
  expect(text, '不该出现状态码').not.toMatch(/\b404\b/);
}

async function seedSource(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'sources-seed');
  const sid = await initMCP(request, token);
  await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: LABEL, config: { company: 'airbnb' },
  });
}
