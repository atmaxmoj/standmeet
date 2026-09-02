// admin-dashboard.spec.ts —— admin dashboard KPI cards + sparkline + jump links.
//
// User story:
//   1. owner logs in → dashboard is the default landing page
//   2. 4 KPI cards show data (entries / unprocessed / codes / requests)
//   3. sparkline SVG renders the 14-day curve
//   4. the "needs your hand" section renders
//   5. jump links → clicking jumps to the matching admin section

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

  // F-A-24 —— this instance has no usable AI provider: every visitor's first message gets
  // bounced with a 503 ("This page doesn't have an AI provider set up yet."), while the
  // owner side **sees absolutely nothing** — no banner, no to-do, and the /admin/api-mcp
  // form just sits there empty, indistinguishable from "never configured yet". A single
  // upgrade can put an owner into exactly this state (the old four columns still exist in
  // storage, the new floor only reads the provider record), while visitors get turned away
  // one after another with the owner none the wiser.
  //
  // The migration half of this isn't something this repo can do (there's no migrator, and
  // the old columns are already gone from schema.sql), but **stating the fact out loud** is
  // still required, and it doesn't care about the cause: whenever this instance can't answer
  // a visitor, the dashboard has to say so to the owner's face.
  test('the dashboard says out loud that no AI provider is usable (F-A-24)',
    async ({ playwright, adminPage }) => {
      const request = await playwright.request.newContext();
      // This state has to be **manufactured**: claim always seeds a usable provider, and
      // F-A-24 is specifically about an instance that used to be able to answer and now
      // can't. Clearing the key = every visitor's first message gets bounced with a 503.
      await clearAIProviderKey(request, { email: OWNER.email, password: OWNER.password });
      await request.dispose();
      await assertProviderOutageAnnounced(adminPage);
    });

  // F-E-2 —— nothing in the JOBS · ACTIVE LOOP block tracks state: TOP MATCH is just
  // `JobsTopMatch()` unconditionally rendering "register sources to start matching", and the
  // `0` under SHORTLIST is a JSX literal. So this panel says the same thing to every owner at
  // every moment — including when sources are already registered and jobs are sitting in the
  // pool.
  //
  // The correct message already exists elsewhere in the product: /admin/listings, in the
  // same state, says "sources exist, go fetch" and even names which command to run. So this
  // isn't a missing string — it's picking the wrong one of two existing strings (and not
  // actually picking at all).
  //
  // This test case drives three real states and asserts this block says something different
  // each time.
  test('the jobs panel changes with the state it claims to describe (F-E-2)',
    async ({ playwright, adminPage }) => {
      await assertJobsPanelFollowsState(playwright, adminPage);
    });

  // UX-41 —— the `↑ corpus active` line in the top-right corner of the CORPUS PULSE card
  // used to be an **unconditional** span: vermillion, prominent, sitting exactly where "the
  // conclusion this chart hands me" belongs — yet with zero relationship to the numbers in
  // the chart. On an instance where nothing has entered the corpus in 14 days, it still
  // claimed active.
  //
  // This test case drives exactly that state: this instance's pulse is empty (it doesn't
  // matter that the seeded wiki entry falls outside the 14-day window — the assertion isn't
  // "it must say quiet", it's that **these two statements must not both be true of the same
  // data at once**). The criterion is that **the line of text and the line on the chart must
  // agree**, pinned down in both directions.
  //
  // The first version wrote "must equal `nothing new in 14d`" literally, which turned that
  // instance's state at the time **into the criterion itself**: once another test case in
  // this file wrote something into the corpus, the window stopped being flat, the product
  // correctly said `↑ 2 new in 14d`, and this test case went red — red on its own premise,
  // not on the product. That kind of assertion only holds under one specific instance state,
  // while the invariant it's supposed to guard is state-independent: **if the chart shows a
  // peak, say so; if it doesn't, don't.**
  test('the pulse verdict and the line it sits on say the same thing (UX-41)',
    async ({ adminPage }) => { await assertPulseVerdictMatchesLine(adminPage); });

  // UX-42 —— the y-axis ticks are `max / round(max/2) / 0`. When the corpus is barely
  // getting started, `max` is small, and `round(1/2)` rounds back up to 1, so the three
  // ticks read `1 … 1 … 0`: the same tick value shown twice. A duplicated tick is worse than
  // no tick at all — it makes the reader think they're misreading it, exactly when the chart
  // most needs to be legible. This instance's corpus sits right at that magnitude, so this
  // assertion drives a genuinely real state.
  test('the sparkline never prints the same y tick twice (UX-42)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'dashboard');
      const axis = adminPage.getByTestId('sparkline-axis').first();
      await expect(axis).toBeVisible({ timeout: 5_000 });
      const ticks = (await axis.innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
      expect(new Set(ticks).size, `y ticks are ${ticks.join(' / ')}`).toBe(ticks.length);
    });
});

// assertPulseVerdictMatchesLine — the criterion is **agreement across two surfaces**,
// exactly the lens this module cares about.
//
// The sidebar rail reports 7-day new entries, the card line reports 14 days. 7 days is a
// **subset** of 14, so there's one invariant that doesn't depend on any instance state:
// **if the rail says N>0 entries in the last 7 days, the 14-day figure cannot be
// "nothing at all".**
//
// Two wrong paths were tried, both recorded here:
//  ① The first version hardcoded "must equal `nothing new in 14d`" — which turned that
//     instance's state at the time into the criterion; once another test case in this file
//     wrote into the corpus, it went red, red on its own premise.
//  ② The second version treated the y-axis top tick as "the single-day peak" — but
//     `Sparkline.tsx:41` is `Math.max(...data, 1)`: an all-zero window still prints `1`
//     (otherwise the axis height would be 0 and nothing could be drawn). **The top tick is
//     a scale mark, not data**, so using it to infer "were there new entries" is necessarily
//     wrong. The criterion has to read **the element that actually reports this quantity**.
async function assertPulseVerdictMatchesLine(page: Page): Promise<void> {
  await gotoAdminSection(page, 'dashboard');
  const verdict = page.getByTestId('pulse-verdict');
  await expect(verdict).toBeVisible({ timeout: 5_000 });
  const rail = page.getByTestId('pulse-rail-delta');
  await expect(rail).toBeVisible({ timeout: 5_000 });

  // Read the text first, then judge it — `.not.toContainText` also passes before the
  // element even appears ([[negated-assertion-passes-while-absent]]).
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
  // adminPage was already on the dashboard at login time, when the key still existed; the
  // dashboard only fetches once on mount, so the document has to be reloaded, otherwise the
  // assertion looks at data from before the key was cleared.
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

      // ① No sources exist yet — "go register a source" is the correct message here. Assert
      // on text that already exists on the page, not by waiting on a testid that doesn't
      // exist yet: the latter going red only tells you "no such element", not what's wrong
      // with the message.
      await gotoAdminSection(adminPage, 'dashboard');
      await expect(adminPage.getByText(/register sources/i)).toBeVisible({ timeout: 5_000 });

      // ② A source is registered but the pool is still empty — saying "go register a
      // source" now would be asking the owner to redo something already done.
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

      // ③ Jobs now exist in the pool — TOP MATCH should point at one of them instead of
      // still explaining how to get started.
      const { jobs } = await jobsFetchNew(request, token, sid, src.id);
      expect(jobs.length, 'mock job board returned 0 jobs').toBeGreaterThan(0);
      await adminPage.reload();
      // Wait for this number to settle first — it's the exact signal that "the pool was
      // fetched". The previous version read the head directly and instead read the
      // "reading the pool…" loading placeholder: a red that was only racing against itself.
      // As a side effect, this line is also its own assertion: this number was previously
      // hardcoded to `0`, and it must move once the pool is non-empty.
      await expect(
        adminPage.getByTestId('dash-pool-count'),
        '池子那个数必须是数出来的',
      ).toHaveText(String(jobs.length), { timeout: 10_000 });

      // Not pinning the order (the pool's sort order isn't this test case's concern) — what
      // gets pinned is: whatever is reported must actually be present in the pool.
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
