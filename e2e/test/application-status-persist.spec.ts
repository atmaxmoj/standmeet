// application-status-persist.spec.ts —— /admin/applications 详情 modal 的 "status" 分段控件不能
// **假装保存**：点一下 `is-on` 亮到那个段，看起来像存了，一 reload 就悄悄退回原值。
//
// rot-C1（MEDIUM）：ApplicationDetailModal 的 status 只挂在组件本地 useState 上
// （ApplicationDetailModal.tsx:26 `useState<ApplicationStatus>(app.status)`；:208
// `StatusSegmented value={status} onChange={onStatus}`；:213-228 按钮 `onChange → setStatus`）。
// **没有任何持久化**——后端 `/applications` 路由 GET-only（jobsadmin/routes.go:59），真写入走 MCP
// `applications.commit`，根本没有 status-write endpoint。文件头注释却写 "status PATCH 走后端"。
//
// 选定诠释 = **make-honest**（不是「补一条持久化」），依据是设计源本身：
// docs/design/project/admin.js 的 ApplicationDetailModal 把这个段控写成 `onChange={()=>{}}`——
// 一个 no-op，它从来只想**显示**当前状态、从不写。而后端 `status` 列是机器生命周期
// （pending → submitted → failed/withdrawn，domain/application.go），跟 modal 的
// silent/reviewing/replied/rejected/offer 是两套词表，parseAppStatus 把真 commit 行全兜底成
// `silent`——今天没有任何地方能一致地存 `replied`/`offer`。
//
// RED 判据（fix-agnostic 一致性/存活不变式）：打开申请、读亮着的状态、点一个**不同**的段、读点完
// 之后亮的状态；关掉 modal、**reload**（真读实例存了什么）、重开、再读。断言「点完之后亮的」==
// 「reload 之后亮的」。诚实的两种收尾都过：(a) 点击真落库→reload 仍是 target；(b) 控件只读/不提交
// →点击本就是 no-op、`is-on` 没动。唯一挂掉的就是现状：点完亮 `offer`（像存了）、reload 退回
// `silent`——modal 声称了一个实例从没存过的状态。当前代码 → 不相等 → RED。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Locator, Page, Playwright } from '@playwright/test';

import { createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { claimFreshOwner } from '@/fixtures/seed';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const OWNER = {
  email: 'app-status-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'appstatus',
  fullName: 'App Status Owner',
};

// status 枚举跟 applications-model.APPLICATION_STATUSES 对齐（稳定契约，不 import app 内部）。
// StatusSegmented 每个按钮 data-testid=`status-<s>`，选中项带 `is-on` class。
const STATUSES = ['silent', 'reviewing', 'replied', 'rejected', 'offer'] as const;

// commit 后拿到的真 application_id —— 列表行 testid=`application-row-<id>`。
let appId = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /applications · the status control must not claim a status a reload contradicts', () => {
  test.beforeAll(async ({ playwright }) => { appId = await seed(playwright); });

  test('a status shown after an owner click must equal the status shown after a reload',
    statusMustNotOutliveReload);
});

// statusMustNotOutliveReload —— 换状态 → 读点后亮的 → 关掉 → reload → 重开 → 读 reload 后亮的，
// 断言两者相等（诚实控件的不变式；现状的假保存违反它）。
async function statusMustNotOutliveReload({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });

  const modal = await openApplication(page);
  const before = await litStatus(modal);
  // 现状 sanity：段控里确实有一个亮着的状态（selector 打错就在这里红，避免静默变绿）。
  expect(STATUSES, 'the seeded application should show a lit status segment').toContain(before);

  // 点一个跟当前**不同**的状态。tolerant：诚实修法把控件改成只读/禁用时，这里就是 no-op。
  const target = STATUSES.find((s) => s !== before)!;
  const targetBtn = modal.getByTestId(`status-${target}`);
  if (await targetBtn.count() > 0 && await targetBtn.isEnabled()) await targetBtn.click();
  const afterClick = await litStatus(modal);

  // 关掉 modal，**reload**（重新 fetch 实例真正存了什么），再打开同一份申请。
  await modal.getByTestId('application-detail-close').click();
  await expect(page.getByTestId('application-detail-modal')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });
  const afterReload = await litStatus(await openApplication(page));

  // 诚实不变式：owner 动作之后 modal 显示的状态，必须等于 reload 之后显示的状态。
  // 说谎 = 点完亮 `target`（像存了），reload 退回 `before`（本地 useState 随 modal 卸载丢失，
  // 因为没有任何持久化 —— /applications 是 GET-only，写入走 MCP applications.commit）。
  expect(
    afterReload,
    `the status the modal showed after the click ("${afterClick}") did not survive a reload — it `
    + `became "${afterReload}". The segmented control drives status through a component-local useState `
    + `with no persistence, so it paints a saved-looking state that a reload silently loses. An honest `
    + `control is either persisted (survives reload) or read-only (never claims the change).`,
  ).toBe(afterClick);
}

// openApplication —— 打开 appId 那一行的详情 modal（行的主按钮），返回 modal locator。
async function openApplication(page: Page): Promise<Locator> {
  await page.getByTestId(`application-row-${appId}`).getByRole('button').first().click();
  const modal = page.getByTestId('application-detail-modal');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  return modal;
}

// litStatus —— 读段控里当前带 `is-on` 的那个状态 testid（缺失/无按钮时容错返回空串）。
async function litStatus(modal: Locator): Promise<string> {
  for (const s of STATUSES) {
    const btn = modal.getByTestId(`status-${s}`);
    if (await btn.count() === 0) continue;
    const cls = (await btn.getAttribute('class')) ?? '';
    if (cls.split(/\s+/).includes('is-on')) return s;
  }
  return '';
}

// seed —— claim fresh owner，再经 MCP 落一份真 application（jobs.fetch_new → resume.draft →
// applications.commit），返回它的 application_id。列表 GET /api/admin/applications 能读到这行。
async function seed(playwright: Playwright): Promise<string> {
  await claimFreshOwner(playwright, OWNER);
  const request = await playwright.request.newContext();
  const id = await seedApplication(request);
  await request.dispose();
  return id;
}

async function seedApplication(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'app-status-seed');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'App Status Board', config: { company: 'anthropic' },
  });
  const { jobs } = await jobsFetchNew(request, token, sid, src.id);
  if (jobs.length === 0) throw new Error('mock job board returned 0 jobs');
  const drafted = await resumeDraft(request, token, sid, jobs[0]!.cache_id, sampleResumeContent());
  const committed = await applicationsCommit(request, token, sid, drafted.view.draft_id);
  return committed.view.application_id;
}
