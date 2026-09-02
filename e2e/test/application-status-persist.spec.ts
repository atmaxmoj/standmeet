// application-status-persist.spec.ts —— the "status" segmented control in the
// /admin/applications detail modal must not **pretend to save**: clicking lights up
// `is-on` on that segment, looking saved, then a reload silently reverts it.
//
// rot-C1 (MEDIUM): ApplicationDetailModal's status lives only in component-local
// useState (ApplicationDetailModal.tsx:26 `useState<ApplicationStatus>(app.status)`;
// :208 `StatusSegmented value={status} onChange={onStatus}`; :213-228 button
// `onChange → setStatus`). **There is no persistence at all** — the backend
// `/applications` route is GET-only (jobsadmin/routes.go:59); real writes go through
// MCP `applications.commit`, and there is no status-write endpoint. Yet the file-header
// comment still says "status PATCH goes through the backend".
//
// Chosen interpretation = **make-honest** (not "add the missing persistence"), based on
// the design source itself: docs/design/project/admin.js writes this segmented control's
// ApplicationDetailModal as `onChange={()=>{}}` — a no-op. It only ever meant to
// **display** the current status, never to write it. Meanwhile the backend `status`
// column is a machine lifecycle (pending → submitted → failed/withdrawn,
// domain/application.go), a different vocabulary from the modal's
// silent/reviewing/replied/rejected/offer; parseAppStatus falls every real commit row
// back to `silent` — today nothing can consistently store `replied`/`offer`.
//
// RED criterion (fix-agnostic consistency/survival invariant): open an application, read
// the lit status, click a **different** segment, read what's lit after the click; close
// the modal, **reload** (a real read of what the instance actually stored), reopen, read
// again. Assert "lit after the click" == "lit after the reload". Both honest endings
// pass: (a) the click really persists → still `target` after reload; (b) the control is
// read-only/non-submitting → the click is a no-op, `is-on` never moves. The only thing
// that fails is the current behavior: clicking lights up `offer` (looking saved), reload
// reverts to `silent` — the modal claimed a status the instance never stored. Current
// code → not equal → RED.

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

// The status enum matches applications-model's SUBMISSION_STATES (a stable contract, no
// importing app internals). Every StatusSegmented segment has data-testid=`status-<s>`,
// and the selected one carries the `is-on` class.
//
// **This list once fell behind the product**: after the axis changed from "did the
// recruiter reply" (silent/reviewing/replied/rejected/offer) to "how far the submission
// got" (committed/submitted/failed/withdrawn) (F-E-3), the rename only followed the half
// the compiler could see — the hardcoded list here never moved. So `litStatus` always
// returned an empty string, and this spec has been red ever since, for a reason
// unrelated to what it's meant to guard
// ([[harness-drifts-when-vocabulary-changes]]).
const STATUSES = ['committed', 'submitted', 'failed', 'withdrawn'] as const;

// The real application_id obtained after commit — the list row's testid is
// `application-row-<id>`.
let appId = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin /applications · the status control must not claim a status a reload contradicts', () => {
  test.beforeAll(async ({ playwright }) => { appId = await seed(playwright); });

  test('a status shown after an owner click must equal the status shown after a reload',
    statusMustNotOutliveReload);
  test('the active status is visibly different from the others', litSegmentLooksDifferent);
  test('private notes do not accept an edit they cannot keep', notesDoNotPretendToSave);
  test('no control in the modal promises something nothing can perform', modalActionsAreHonest);
  test('「我到底发出去了什么」在这张卡上答得出来', snapshotShowsWhatWasSent);
});

// snapshotShowsWhatWasSent —— F-E-23. **The "RESUME SENT · SNAPSHOT" block must actually
// show that resume.**
//
// It used to be a heading, a divider, and blank space below it: it rendered
// `resumeDelta`, and the frontend only ever assigned that field an empty string. The
// content was always in the application row (the PDF at commit time was rendered from
// it), so "what did I actually send" had no answer anywhere in the product.
//
// This asserts the **content** (the actual text from the resume that was seeded), not
// just "the block exists" — an empty box also exists.
async function snapshotShowsWhatWasSent({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });
  const modal = await openApplication(page);

  const snap = modal.getByTestId('application-resume-snapshot');
  await expect(snap, 'precondition: 那块在屏幕上').toBeVisible();
  // The name / employer / school from sampleResumeContent. ResumePage renders the name
  // in lowercase.
  await expect(snap, '发出去的那份的名字').toContainText('alice anderson');
  await expect(snap, '发出去的那份的经历').toContainText('Acme');
  await expect(snap, '发出去的那份的学历').toContainText('UC Berkeley');
}

// modalActionsAreHonest —— F-E-12 + F-E-13. **Anything on this modal that looks
// clickable either really does something, or says plainly that it can't.**
//
// The first version only walked `.sm-app-modal-foot button`, so it stayed green while
// three other dead buttons on the same modal (`PING IN CHAT` / `VIEW FULL` /
// `DOWNLOAD PDF`) **sat one section outside the scan** — the gate made exactly the
// mistake it existed to catch ([[gate-can-go-blind]]). Scope is now the whole modal.
//
// At the time none of the five had an onClick: clicking did nothing, sent no request,
// and gave no message. `WITHDRAW` was still styled in the vermillion danger color, so an
// owner who clicked it would believe they'd withdrawn.
// `DOWNLOAD PDF` goes a layer deeper: the `applications` table has no PDF column at
// all — that artifact only ever appears once, in commit's return payload. It isn't a
// missed wiring, there's nothing behind it to wire to.
//
// This asserts **each button's own** disabled state, not "is there an explanatory
// sentence": copy can be rewritten, but a property is behavior. Iterating rather than
// naming buttons one by one means a future addition still has to answer for itself.
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
    // CLOSE really does something (closes the modal), so it should be live. Everything
    // else must either really work, or be disabled.
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

// notesDoNotPretendToSave —— F-E-11, the box for check 3.
//
// In the real environment: type a line into PRIVATE NOTES → close → reload → reopen,
// and the text is gone — typing there never sent a single write request. There's no
// save button, and nothing says it doesn't save either.
//
// All three layers are empty: the frontend is plain useState, the list hardcodes notes
// to `''`, and the whole backend `jobs` package has zero hits on `notes`. The design
// does call for this field (job-loop.md's schema + applications.update_status), but that
// write path was never built.
//
// So this asserts the other acceptable shape: **it visibly does not submit**. The
// criterion is the `readOnly`/`disabled` property on the **element itself**, not a
// hunt for an explanatory sentence — copy can be rewritten, but a property is behavior.
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

// litSegmentLooksDifferent —— F-E-10. **The criterion must be computed style, never
// text or a class name.**
//
// In the real environment this box is `committed submitted failed withdrawn` crammed
// together — four words run together with no separator, giving no clue which one is
// current. The DOM is correct the whole time though: `is-on` is there, `data-testid` is
// there, so any assertion that reads text or class names stays green start to finish
// ([[text-assertion-cannot-see-layout]]).
//
// Cause: `sm-atoms.css` hangs all the segmented styling off `.sm-seg button`, but the
// component renders a `<span>` instead — because "something that isn't persisted
// shouldn't look clickable". The capability moved house and its styling boundary didn't
// move with it.
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

// statusMustNotOutliveReload —— change status → read what's lit after the click → close
// → reload → reopen → read what's lit after the reload, and assert the two are equal
// (the invariant an honest control must satisfy; the current fake-save violates it).
async function statusMustNotOutliveReload({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'applications');
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });

  const modal = await openApplication(page);
  const before = await litStatus(modal);
  // Sanity check on the current state: the segmented control does have one lit status
  // (a wrong selector would fail right here, instead of silently passing).
  expect(STATUSES, 'the seeded application should show a lit status segment').toContain(before);

  // Click a status **different** from the current one. Tolerant: once an honest fix
  // makes the control read-only/disabled, this click is simply a no-op.
  const target = STATUSES.find((s) => s !== before)!;
  const targetBtn = modal.getByTestId(`status-${target}`);
  if (await targetBtn.count() > 0 && await targetBtn.isEnabled()) await targetBtn.click();
  const afterClick = await litStatus(modal);

  // Close the modal, **reload** (re-fetches what the instance actually stored), then
  // reopen the same application.
  await modal.getByTestId('application-detail-close').click();
  await expect(page.getByTestId('application-detail-modal')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('applications-list')).toBeVisible({ timeout: 10_000 });
  const afterReload = await litStatus(await openApplication(page));

  // Honest invariant: the status the modal shows after an owner action must equal what
  // it shows after a reload.
  // Lying = lights up `target` after the click (looking saved), then reload reverts to
  // `before` (the local useState is lost when the modal unmounts, because there is no
  // persistence at all — /applications is GET-only, writes go through MCP
  // applications.commit).
  expect(
    afterReload,
    `the status the modal showed after the click ("${afterClick}") did not survive a reload — it `
    + `became "${afterReload}". The segmented control drives status through a component-local useState `
    + `with no persistence, so it paints a saved-looking state that a reload silently loses. An honest `
    + `control is either persisted (survives reload) or read-only (never claims the change).`,
  ).toBe(afterClick);
}

// openApplication —— opens the detail modal for the appId row (the row's primary
// button), and returns the modal locator.
async function openApplication(page: Page): Promise<Locator> {
  await page.getByTestId(`application-row-${appId}`).getByRole('button').first().click();
  const modal = page.getByTestId('application-detail-modal');
  await expect(modal).toBeVisible({ timeout: 5_000 });
  return modal;
}

// litStatus —— reads the status testid currently carrying `is-on` in the segmented
// control (tolerantly returns an empty string when missing/no buttons).
async function litStatus(modal: Locator): Promise<string> {
  for (const s of STATUSES) {
    const btn = modal.getByTestId(`status-${s}`);
    if (await btn.count() === 0) continue;
    const cls = (await btn.getAttribute('class')) ?? '';
    if (cls.split(/\s+/).includes('is-on')) return s;
  }
  return '';
}

// seed —— claims a fresh owner, then lands a real application through MCP
// (jobs.fetch_new → resume.draft → applications.commit), and returns its
// application_id. The list's GET /api/admin/applications can read this row.
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
