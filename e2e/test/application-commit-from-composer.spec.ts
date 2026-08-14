// application-commit-from-composer.spec.ts —— **owner 在界面上点 SEND，就得真的发出去。**
//
// 真环境驱出来的（F-E-9）：composer 的 `SEND →` 弹一张确认框，逐条列后果 ——
//   "Sending will freeze the resume + cover letter snapshot, render the final PDF (with QR),
//    and write an application row. The auto-issued AccessCode will be 180 days, 10 sessions,
//    50 turns."
// —— 点确认之后 `applications` 表 0 行，那一段后端日志里只有 GET，一个 POST 都没有，
// 而且界面不吭声。`DraftsSection.tsx:50` 把 `onSend` 传成了 `onClose`。
//
// **这比「按钮没接线」重一档**：产品先征求了同意、把四件后果摆出来、拿到点头，然后一件都没做。
// owner 会以为自己投了。
//
// 为什么这条 spec 走 GUI 而不是打 API：缺陷**只存在于界面那一侧**，MCP 那条路一直是通的
// （`applications-commit.spec.ts` 一直绿）。测在缺口下面那一层就永远看不见它
// —— 本轮反复栽的同一个坑。

import { test, expect } from '@/fixtures/test';
import type { Page, APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { gotoAdminSection } from '@/fixtures/navigate';
import { resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'composer@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'composer',
  fullName: 'Composer Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('jobs · the composer SEND actually commits', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('confirming SEND writes an application and clears the draft', async ({
    adminPage, request,
  }) => {
    await seedOneDraft(request);

    // 前置条件要能红：草稿不在的话，下面点不到 composer，而"没有 application"会退化成恒真。
    await expect.poll(() => countApplications(adminPage), { timeout: 10_000 }).toBe(0);

    await gotoAdminSection(adminPage, 'drafts');
    await adminPage.getByRole('button', { name: /open composer/i }).first().click();
    await adminPage.getByTestId('composer-send').click();
    // 确认框把后果列出来了 —— 它说的每一件，下面都要真的发生。
    await expect(adminPage.getByTestId('composer-confirm-send')).toBeVisible();
    await adminPage.getByTestId('composer-confirm-send').click();

    await expect.poll(
      () => countApplications(adminPage), { timeout: 30_000 },
    ).toBe(1);
    // 草稿被同一笔事务删掉 —— 否则 owner 会把同一份再投一次。
    await expect.poll(
      () => countDrafts(adminPage), { timeout: 10_000 },
    ).toBe(0);
  });
});

// countApplications / countDrafts —— 走产品**自己的**读路（admin API），不是直连库：
// 界面读到什么，断言就读什么。
async function countApplications(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const r = await fetch('/api/admin/applications', { credentials: 'include' });
    const rows = await r.json() as unknown[];
    return Array.isArray(rows) ? rows.length : -1;
  });
}

async function countDrafts(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const r = await fetch('/api/admin/drafts', { credentials: 'include' });
    const rows = await r.json() as unknown[];
    return Array.isArray(rows) ? rows.length : -1;
  });
}

// seedOneDraft —— 一条真形状的草稿：注册源 → fetch → 对第一条岗位起草。
async function seedOneDraft(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'composer-spec');
  const sid = await initMCP(request, token);
  await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
  });
  const fetched = await jobsFetchNew(request, token, sid);
  expect(fetched.jobs.length, 'precondition: a job landed in the pool').toBeGreaterThan(0);
  await resumeDraft(request, token, sid, fetched.jobs[0]!.cache_id, sampleResumeContent());
}
