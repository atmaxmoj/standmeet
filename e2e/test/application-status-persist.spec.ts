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

// status 枚举跟 applications-model 的 SUBMISSION_STATES 对齐（稳定契约，不 import app 内部）。
// StatusSegmented 每一段 data-testid=`status-<s>`，选中项带 `is-on` class。
//
// **这份清单曾经落后于产品**：轴从「recruiter 回没回」(silent/reviewing/replied/rejected/offer)
// 换成「投递到哪一步」(committed/submitted/failed/withdrawn) 之后（F-E-3），改名只跟到了编译
// 得到的那一半，这里的硬编码没动 —— 于是 `litStatus` 永远返回空串，这条 spec 从那天起一直红着，
// 而红的原因跟它要守的东西无关（[[harness-drifts-when-vocabulary-changes]]）。
const STATUSES = ['committed', 'submitted', 'failed', 'withdrawn'] as const;

// commit 后拿到的真 application_id —— 列表行 testid=`application-row-<id>`。
let appId = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /applications · the status control must not claim a status a reload contradicts', () => {
  test.beforeAll(async ({ playwright }) => { appId = await seed(playwright); });

  test('a status shown after an owner click must equal the status shown after a reload',
    statusMustNotOutliveReload);
  test('the active status is visibly different from the others', litSegmentLooksDifferent);
  test('private notes do not accept an edit they cannot keep', notesDoNotPretendToSave);
  test('no control in the modal promises something nothing can perform', modalActionsAreHonest);
});

// modalActionsAreHonest —— F-E-12 + F-E-13。**这张弹窗上任何看起来能点的东西，要么真能做，
// 要么明说做不了。**
//
// 第一版只遍历 `.sm-app-modal-foot button`，于是它绿着，而同一张弹窗上另外三颗死按钮
// （`PING IN CHAT` / `VIEW FULL` / `DOWNLOAD PDF`）**就在扫描范围之外一节** ——
// 闸门自己犯了它要防的那个错（[[gate-can-go-blind]]）。范围现在是整张弹窗。
//
// 五颗当时都没有 onClick：点下去状态不变、一个请求都不发、连一句提示都没有。
// `WITHDRAW` 还是朱红的危险色，owner 点完会以为撤回了。
// 而 `DOWNLOAD PDF` 更深一层：`applications` 表根本没有 PDF 列，那份产物只在 commit 的
// 回参里出现一次 —— 不是忘了接线，是背后没有东西可接。
//
// 断的是**每一颗**按钮自己的 disabled，不是「有没有那句解释」：文案会改，属性是行为。
// 遍历而不是点名 —— 将来加一颗照样得给出答案。
async function modalActionsAreHonest({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });
  const modal = await openApplication(page);

  const buttons = modal.locator('button');
  const n = await buttons.count();
  expect(n, 'precondition: the modal has buttons').toBeGreaterThan(3);

  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const label = ((await b.textContent()) ?? '').trim();
    // CLOSE 真的会做事（关掉弹窗），它该是活的。其余的必须要么真能做，要么禁用。
    if (/close/i.test(label)) continue;
    const wired = await b.evaluate((el) => el.onclick !== null);
    if (wired) continue;
    expect(
      await b.isDisabled(),
      `"${label}" has no click handler and nothing in the stack performs it, yet it is enabled — `
      + 'clicking it changes nothing and says nothing.',
    ).toBe(true);
  }
}

// notesDoNotPretendToSave —— F-E-11，check 3 的那一格。
//
// 真环境：往 PRIVATE NOTES 里写一句话 → 关 → reload → 重开，字没了，而打字那一段后端
// 一个写请求都没有。没有保存按钮，也没有任何字样说它不保存。
//
// 三层都是空的：前端纯 useState，列表把 notes 硬编码成 ''，后端整个 jobs 包 `notes` 零命中。
// 设计里这一格是有的（job-loop.md 的 schema + applications.update_status），但那个写口从没建过。
//
// 所以断的是 item 给的另一种合格形态：**看得出来不提交**。判据取 `readOnly`/`disabled`
// 这类**元素自己**的属性，而不是找一句提示文案 —— 文案会被改写，属性是行为。
async function notesDoNotPretendToSave({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });
  const modal = await openApplication(page);

  const notes = modal.getByTestId('application-detail-notes');
  await expect(notes, 'precondition: the notes control is on screen').toBeVisible();
  const editable = await notes.evaluate(
    (el) => !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled,
  );
  expect(
    editable,
    'the notes box takes an edit and drops it on reload — nothing persists notes anywhere in the '
    + 'stack. Until there is a writer it must not look like a field that saves.',
  ).toBe(false);
}

// litSegmentLooksDifferent —— F-E-10。**判据必须是计算样式，不能是文本或类名。**
//
// 真环境上这一格是一个框里挤着 `committed submitted failed withdrawn` —— 四个词连成一串、
// 没有分隔、看不出当前是哪个。而 DOM 一直是对的：`is-on` 在、`data-testid` 在，
// 所以任何读文本 / 读类名的断言从头到尾都是绿的（[[text-assertion-cannot-see-layout]]）。
//
// 原因：`sm-atoms.css` 里分段样式全挂在 `.sm-seg button` 上，而组件为了「不落库的东西
// 不该看起来能点」渲染的是 `<span>`。能力搬了家，它的边没跟着走。
async function litSegmentLooksDifferent({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });
  const modal = await openApplication(page);

  const lit = await litStatus(modal);
  expect(STATUSES, 'precondition: one segment is lit').toContain(lit);
  const dim = STATUSES.find((s) => s !== lit)!;

  const paint = (s: string) => modal.getByTestId(`status-${s}`).evaluate((el) => {
    const cs = getComputedStyle(el);
    return `${cs.backgroundColor}|${cs.color}`;
  });
  expect(
    await paint(lit),
    `the lit segment ("${lit}") is painted exactly like an inactive one ("${dim}"), so the owner `
    + 'cannot tell which status this application is in. The rules live on `.sm-seg button` while '
    + 'the component renders <span>.',
  ).not.toBe(await paint(dim));
}

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
