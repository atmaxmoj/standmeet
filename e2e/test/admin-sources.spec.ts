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
});

async function seedSource(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'sources-seed');
  const sid = await initMCP(request, token);
  await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: LABEL, config: { company: 'airbnb' },
  });
}
