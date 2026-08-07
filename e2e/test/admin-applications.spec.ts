// admin-applications.spec.ts —— admin applications: empty state, card after
// commit, detail modal with timeline.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'apps@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'apps',
  fullName: 'Apps Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin applications UI', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('empty state → "No applications" message',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      await expect(adminPage.getByText(/no applications/i)).toBeVisible();
    });

  test('after commit → application card appears',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      await seedApplication(request);
      await request.dispose();
      await gotoAdminSection(adminPage, 'applications');
      await adminPage.waitForURL('**/admin/applications', { timeout: 5_000 });
      // At least one row/card should appear (not the empty state)
      await expect(adminPage.getByText(/no applications/i)).toHaveCount(0, { timeout: 5_000 });
    });

  // F-E-3 —— 刚 commit 的申请卡片上写着 `SENT —`:一个断言"已投出"的标签,配一个不存在的日期。
  // 真相在库里:`applications.status` 建出来就是 'pending'、`submitted_at` 是 NULL,而**没有任何
  // 代码会改它们** —— job-loop 第 4 步(Playwright 真投递)还不存在,所以"sent"这个词在今天的产品里
  // 没有东西能让它变成真的。前端离得更远:它的枚举是 silent/reviewing/replied/rejected/offer
  // (recruiter 回没回),跟后端的 pending/submitted 完全不相交,于是每一行都被兜底渲染成 SILENT。
  //
  // 这条断言只要求一件事:卡片报**产品真的知道的**那件事 —— 已 commit(日期是真的)、投递尚未记录。
  test('a committed application reports what the product actually knows (F-E-3)',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      await seedApplication(request);
      await request.dispose();
      await gotoAdminSection(adminPage, 'applications');
      const card = adminPage.getByTestId('applications-list').locator('> div').first();
      await expect(card).toBeVisible({ timeout: 5_000 });

      const today = new Date().toISOString().slice(0, 10);
      await expect(card, 'commit 是真发生过的,日期必须是真的').toContainText(today);

      // 取一次文本再断言。`.not.toContainText()` 是会重试的,而元素还没出现的那一刻它也算过 ——
      // 一条永远能绿的断言;这一版把它变成对一个确定字符串的判断。
      const cardText = (await card.innerText()).toLowerCase();
      expect(
        cardText,
        '没有任何代码会把它变成 submitted,所以卡片不许把 commit 说成 sent',
      ).not.toMatch(/\bsent\b/);
      expect(
        cardText,
        'recruiter 有没有回,产品根本没有写入口 —— 不许兜底编一个 SILENT 出来',
      ).not.toMatch(/\bsilent\b/);
      await expect(
        card.getByTestId(/^application-state-/),
        '状态说的是投递这条轴:刚 commit = committed',
      ).toHaveText(/committed/i);

      const headerText = (
        await adminPage.getByTestId('section-header').innerText()
      ).toLowerCase();
      expect(headerText, '标题也一样:数的是申请,不是已投出的申请').not.toMatch(/\bsent\b/);
    });
});

async function seedApplication(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'apps-seed');
  const sid = await initMCP(request, token);
  // Use 'airbnb' company — mock job board has data for it
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Apps Test Board',
    config: { company: 'airbnb' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs for airbnb');
  const { view } = await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
  await applicationsCommit(request, token, sid, view.draft_id);
}
