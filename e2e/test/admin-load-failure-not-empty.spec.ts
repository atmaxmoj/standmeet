// admin-load-failure-not-empty.spec.ts — a failed load must **not** render as an authoritative
// statement of emptiness.
//
// This guards a whole class, not one spot. The rule itself is already written in
// `use-latest-list.ts`:
//   "Do not let a failed load go silent as an empty list: empty vs 'did not load' must stay
//   distinguishable to the owner."
// Three places didn't follow it, all via `.catch(() => set<empty>())`: the GET fails, and the
// component renders as if it "fetched successfully, and it's empty" regardless.
//
// Why this is a **real bug** and not fastidiousness: in each of these spots, the empty state is
// **a statement the owner will genuinely believe**.
//   - the code card: "(role grants nothing)" — reads as "this code can't read anything at all", a
//     lie that **looks safe**. The owner concludes it's already locked down and doesn't narrow it
//     further. The truth is the GET 500'd, and everything the role grants is still readable.
//   - the dashboard: "0 sent" / an empty recent-visitors list — reads as "nothing happened", not
//     "didn't load".
// The silence happens to point exactly toward "nothing to worry about", so the owner never
// notices it — they just believe it.
//
// How this was found (the origin of this spec): in prod, `GET /codes/{id}/corpus` returned 500
// for every code (the DB volume was older than the new table), and the GUI showed **not a single
// visible error** — all six cards neatly said "(role grants nothing)". The 500 only showed up in
// the console.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection, reloadAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'loadfail@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'loadfail',
  fullName: 'Load Failure Owner',
};

// LIES — each string is something a `.catch(() => set<empty>())` would print out, and something
// the owner would take at face value.
const GRANTS_NOTHING = /role grants nothing/i;
// The two lines for F-N-7. They're the same family as the line above, just with the fault at a
// different layer: it isn't a catch swallowing the error — it's that **the render side has no
// error branch at all** — after a failure the list is an empty array, so it falls straight into
// the empty state.
const NO_ROLES_YET = /no roles yet/i;
const NOTHING_BANNED = /no ips banned/i;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin · a failed load must not render as an authoritative empty', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('code corpus: a 500 does not become “(role grants nothing)”', corpusLoadFailure);
  test('code corpus: a 500 surfaces to the owner', corpusLoadFailureIsVisible);
  test('dashboard: a 500 does not become “0 sent”', dashboardCountLoadFailure);
  test('session: a 500 on /me does not become “you are signed out”', meFailureIsNotSignedOut);
  test('session: a 401 on /me still sends the owner to /login', meUnauthedStillRedirects);
  test('a failed load speaks English, not HTTP', failureSpeaksEnglish);
  test('the shell stops calling itself live while the instance is not answering', liveDotTracksReachability);
  test('dashboard: a load still in flight does not become “nothing new in 14d”',
    dashboardInFlightIsNotZero);
  test('system: usage still in flight does not become “no owner-key LLM calls”',
    usageInFlightIsNotZero);
  test('system: a 500 on sandbox workspaces does not become “None here means none in use”',
    sandboxLoadFailure);
  test('roles: a 500 does not become “no roles yet”', rolesLoadFailure);
  test('security: a 500 does not become “no IPs banned”', securityLoadFailure);
  test('a genuinely empty list still shows its empty state', emptyStateStillShows);
});

// rolesLoadFailure — F-N-7. **Driven out by a real environment**: in prod, with only
// `/api/admin/roles` returning 500 (every other block loaded fine), `/admin/roles` printed
// "No roles yet — public is normally seeded on owner claim." while that instance actually had
// three roles.
//
// Why this page is worse than the others: it's the **master switch for permissions**, and the
// empty-state line is both a statement about the world ("this instance has no roles yet") and a
// pointer toward an action (`+ NEW ROLE`). The owner might create a new role on top of
// configuration they never actually read, or conclude visitors can't read anything right now.
async function rolesLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  // A regex, not a glob: the real path is `/api/admin/roles/` (with a trailing slash), and a
  // glob's `*` doesn't cross `/`. The first version was written as `**/api/admin/roles*` — it
  // intercepted nothing, the page rendered its usual three role cards, and yet the assertion still
  // went red (red on "no failure notice shown"). **That kind of red looks exactly like a real
  // defect** ([[read-the-failure-before-theorising]]) — it only became clear from the failure
  // screenshot.
  const probe = fail(adminPage, /\/api\/admin\/roles/);
  await reloadAdminSection(adminPage, 'roles');
  await expectInjected(probe, 'roles');
  await expect(
    adminPage.getByTestId('section-load-failed'),
    'the owner must be told the role list failed to load',
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    adminPage.getByText(NO_ROLES_YET),
    'the fetch failed — “no roles yet” is a claim about the world, and this instance has roles',
  ).toHaveCount(0);
}

// securityLoadFailure — the single most dangerous line in this family: "No IPs banned. The
// public surface is open." Printing it on a failure means answering the owner's question "who
// have I banned?" with "nobody, the door is open" — when the truth is the data never loaded.
async function securityLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  const probe = fail(adminPage, /\/api\/admin\/ip-bans/);
  await reloadAdminSection(adminPage, 'ip-bans');
  await expectInjected(probe, 'ip-bans');
  await expect(
    adminPage.getByTestId('section-load-failed'),
    'the owner must be told the ban list failed to load',
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    adminPage.getByText(NOTHING_BANNED),
    'a failed load must not answer “nobody is banned, the surface is open”',
  ).toHaveCount(0);
}

// emptyStateStillShows — **the opposite direction**. Without this case, an implementation that
// simply "never renders an empty state at all" would also turn the two cases above green, while a
// genuinely empty instance would stare at a section that says nothing at all (a neighbor of
// [[assertion-that-cannot-fail]]: a guard pinned in only one direction can be satisfied by the
// laziest wrong implementation).
//
// No fault is injected here — this is the case where the fetch succeeds and the list is really
// empty. This instance has issued codes and created roles, so it needs a list that's
// **genuinely empty** to begin with: the `security` ban table is empty on a clean instance.
async function emptyStateStillShows({ adminPage }: { adminPage: Page }): Promise<void> {
  await reloadAdminSection(adminPage, 'ip-bans');
  await expect(
    adminPage.getByText(NOTHING_BANNED),
    'a genuinely empty list must still say so — silence is not an empty state',
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    adminPage.getByTestId('section-load-failed'),
    'nothing failed here — do not cry load failure on a healthy empty list',
  ).toHaveCount(0);
}

// failureSpeaksEnglish — F-N-5. The cases above guard "don't render a failure as empty"; this one
// guards **the actual words printed**: with backend really stopped in prod, `/admin/wiki` printed
//     GET /corpus/wiki failed: 500
// — an HTTP verb, an internal path, and a status code, all three thrown in the owner's face.
// CLAUDE.md's rule says, word for word, "Errors must be user-friendly at the UI. No raw stack
// traces, no exit codes, no technical jargon."
//
// The cause sits at **the single convergence point**: `throwAPIError` in `lib/api/admin.ts` uses
// `${method} ${path} failed: ${status}` as the fallback for APIError.message, and roughly twenty
// sections print that message straight to the screen. This lesson was already written into the
// product once — the comment at `use-obsidian.ts:70` reads verbatim: "a human sentence, never
// `import failed: 400`. The owner is not debugging" — it just never got swept to its neighbors.
//
// The criterion checks **the actual text on screen**: no HTTP verb, no internal path like
// `/corpus/`, no bare status code may appear, and there must genuinely be a sentence present
// (otherwise "shows nothing at all" would also pass — that's a different defect, not a fix).
async function failureSpeaksEnglish({ adminPage }: { adminPage: Page }): Promise<void> {
  // What's injected is a **500 with no envelope** (a real process crash / reverse-proxy 502 looks
  // exactly like this), because what needs verifying is exactly this: "what shows on screen when
  // the backend gives back not one word of its own."
  // The `fail()` helper above sends `{error:{message:'boom'}}`, and the product faithfully prints
  // 'boom' for that — that exercises a different branch and can't reach the fallback string.
  await adminPage.route('**/api/admin/corpus/wiki**', (route) => route.fulfill({
    status: 500, contentType: 'text/plain', body: 'upstream connect error',
  }));
  await reloadAdminSection(adminPage, 'wiki');
  const shown = adminPage.getByTestId('wiki-error');
  await expect(shown, 'the owner must be told the list failed to load').toBeVisible({ timeout: 15_000 });
  const text = (await shown.innerText()).trim();
  expect(text.length, 'an empty error line tells the owner nothing').toBeGreaterThan(10);
  expect(text, `owner-facing copy must not be a request line: "${text}"`)
    .not.toMatch(/\b(GET|POST|PUT|PATCH|DELETE)\b|\/corpus\/|\bfailed: \d{3}\b/);
}

// liveDotTracksReachability — F-N-6. The vermillion dot in the top bar sits next to the word
// `live`, and it reads **thin air**: there's no input feeding `LiveDot` at all — dev, prod, and a
// stopped backend all look identical. In prod, after really stopping the backend once and
// clicking a sidebar item: the body says that section failed to load, and the top bar still says
// `● LIVE`.
//
// "What's still alive" is precisely the one question the status light exists to answer (the same
// role as `last used` on the api·mcp key card). Criterion: after injecting a fault, the word
// `live` must **change** (if it can't say anything, it shouldn't say "live"), and under normal
// conditions it must be present — pin both directions, otherwise "just delete the light" would
// also turn a one-directional assertion green.
async function liveDotTracksReachability({ adminPage }: { adminPage: Page }): Promise<void> {
  const liveWord = adminPage.getByTestId('shell-liveness');
  await gotoAdminSection(adminPage, 'wiki');
  await expect(liveWord, 'a healthy instance says live').toHaveText(/live/i, { timeout: 15_000 });

  // What's stopped is **the entire backend**, not one endpoint: when a single endpoint 500s, the
  // machine is still answering, and saying "live" then would be correct. What needs reproducing is
  // the real prod scene of stopping the backend — the session is already in hand (no reload, just
  // clicking sidebar items to switch sections), and every request is unreachable.
  await adminPage.route('**/api/admin/**', (route) => route.fulfill({
    status: 500, contentType: 'text/plain', body: 'upstream connect error',
  }));
  await gotoAdminSection(adminPage, 'raw');
  await expect(
    liveWord, `the instance answers nothing and the shell still calls itself live`,
  ).not.toHaveText(/^live$/i, { timeout: 15_000 });
  // Check what it changed to, specifically — asserting only "it's not live" would let rendering
  // blank pass too.
  const word = (await liveWord.innerText()).trim();
  expect(word.length, 'the dot must say what is wrong, not go blank').toBeGreaterThan(3);
}

// meUnauthedStillRedirects — the opposite direction. Without this case, an implementation that
// simply "never redirects at all" would also turn the case above green, while a genuinely expired
// session would get stuck on a "couldn't reach the server" message — the same defect, just facing
// the other way.
async function meUnauthedStillRedirects({ adminPage }: { adminPage: Page }): Promise<void> {
  await adminPage.route('**/api/admin/me', (route) => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'unauthorized', message: 'no session' } }),
  }));
  await reloadAdminSection(adminPage, 'roles');
  await adminPage.waitForURL('**/login', { timeout: 10_000 });
}

// meFailureIsNotSignedOut — F-N-2. The fourth spot in the same family, wearing a different
// costume: **"you are signed out" is also a statement about the world**, and it can equally be
// false.
//
// `use-admin-session.ts:41/:59` treats any fetch `error` as unauthed → `router.push('/login')`.
// 401 and 500 collapse into the same handling, but the two mean opposite instructions to the
// owner: a 401 means go sign in; a 500 means the server is down, and signing in won't help. Once
// merged, the product hands the owner exactly the advice that doesn't work, and they'll assume
// it's their password and re-enter it over and over.
//
// RED (before the fix): bounced to /login, with not one word on the page about the server.
//
// **This must reload the whole page**, not just click a sidebar item: `gotoAdminSection` is a
// client-side navigation, `sessionStore` still holds the `ready` state from the first load, and
// `/me` never gets fetched again at all — that's exactly how the first version of this test was
// written, so the case passed even on unfixed code, and it passed only because **the fault was
// never actually injected**. The scene the owner actually hits is a reload (the server is down,
// they refresh, or open a new tab).
async function meFailureIsNotSignedOut({ adminPage }: { adminPage: Page }): Promise<void> {
  fail(adminPage, '**/api/admin/me');
  await reloadAdminSection(adminPage, 'roles');
  // Wait for **whichever of the two outcomes shows up first** (the sign-in form, or the message)
  // before asserting — this avoids sleeping a fixed duration, and both assertions can still go
  // red. Waiting only for the message would mean the failure message on a real defect is just
  // "element not found", which doesn't say what actually happened (the owner got bounced to
  // sign-in).
  const signInForm = adminPage.getByTestId('email');
  const unreachable = adminPage.getByText(/couldn’t reach|could not reach|not reachable/i).first();
  await expect(signInForm.or(unreachable).first()).toBeVisible({ timeout: 10_000 });
  expect(
    new URL(adminPage.url()).pathname,
    'a 500 is not a sign-out — do not bounce the owner to /login',
  ).not.toBe('/login');
  // The wording has to be specific enough that only this branch could produce it — a looser match
  // like /server/i would get hit by unrelated text elsewhere on the page, and that's an assertion
  // that can never go red again.
  await expect(
    unreachable, 'a 500 on /me must say the server could not be reached',
  ).toBeVisible();
}

// fail — pin some admin GET to always return 500 (a deterministic stand-in for a real fault; in
// prod it was a missing table).
//
// Returns a **hit counter**, and callers must assert it's > 0. This file already paid for that
// lesson once (see the `dashboardCountLoadFailure` section), and I paid for it again today: the
// `*` in `'**/api/admin/roles*'` doesn't cross `/`, the real path `/api/admin/roles/`
// **intercepted nothing**, the page rendered its usual three role cards — and the assertion still
// went red (red on "no failure notice"), looking exactly like a real defect. Prove first that
// "this request really was pinned to 500", and that kind of false red can never happen again.
function fail(page: Page, glob: string | RegExp): { hits: () => number } {
  let hits = 0;
  void page.route(glob, (route) => {
    hits += 1;
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'boom' } }),
    });
  });
  return { hits: () => hits };
}

// hold — **hang** some GET mid-air until the test itself releases it (a sibling of `fail`: that
// one pins to 500, this one pins in transit).
//
// Not "hold it for N ms" — that's just a sleep in disguise inside an e2e test: the window is a
// guess, and a busy machine breaks it. Holding it lets the "loading" frame last as long as needed,
// and releasing it lets the case go on to assert the real numbers show up afterward — so this one
// case guards both ends at once: **must not say zero while it hasn't loaded, must say the real
// thing once it has**.
// It likewise returns a hit counter: if nothing gets intercepted, the page loads instantly, every
// assertion passes, and none of it verified anything ([[assertion-that-cannot-fail]]).
function hold(page: Page, glob: string | RegExp): {
  hits: () => number; release: () => void;
} {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let hits = 0;
  void page.route(glob, async (route) => {
    hits += 1;
    await gate;
    await route.continue();
  });
  return { hits: () => hits, release: () => { release(); } };
}

// dashboardInFlightIsNotZero — the twin of this family: **"hasn't loaded yet" must not be
// rendered as a statement about the world, exactly like "failed"**.
//
// Hit in the real environment (UX-41's red, batch #3): while the dashboard was still loading, the
// four big numbers honestly showed `—`, while **on the same screen** the sentences derived from
// those numbers asserted zero — `↑ 0 total`, `at zero`, `0 entries · total`, `nothing new in 14d`.
// The rail on the left sidebar simultaneously said `+2 in 7d`. Same moment, same data, and the
// machine was saying "I don't know yet" and "there is nothing" at the same time.
//
// Cause: `DashboardSection` only passes `loading` into the **value** cell of `Kpi`, while the
// trend / verdict / totals are computed by the caller directly from the zeros in `EMPTY_STATS`
// ([[lesson-not-swept-to-neighbours]]: the lesson only made it to half of the numbers).
async function dashboardInFlightIsNotZero({ adminPage }: { adminPage: Page }): Promise<void> {
  const probe = hold(adminPage, /\/api\/admin\/stats\/growth/);
  // reload, not goto: the shell might already be sitting on this page, in which case this request
  // never fires again, and the "loading" frame simply wouldn't exist
  // ([[assertion-that-cannot-fail]]).
  // Not awaited: what needs observing is exactly the loading frame.
  void reloadAdminSection(adminPage, 'dashboard');
  await expectInjected(probe, 'growth');
  // First prove "it genuinely hasn't loaded yet at this moment", otherwise the `.not.` assertions
  // below would pass trivially on a page where the data already arrived. First wait for the
  // dashboard to mount **in the new document**: reload is async, and reading the element directly
  // could read it off the old document mid-teardown, timing out with "not found" — that kind of
  // red looks just like a real defect but is actually a timing issue.
  await expect(adminPage.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });
  // `.first()`: "loading…" appears in more than one place while loading (once in the title, once
  // in the sidebar rail), and in strict mode `getByText` fails outright on "matched 2 elements"
  // ([[read-the-failure-before-theorising]]).
  await expect(
    adminPage.getByText(/loading…/).first(),
    'this case only means anything while the load is in flight',
  ).toBeVisible({ timeout: 10_000 });

  // Fetch the text and check it explicitly — `.not.toContainText` passes trivially while the
  // element hasn't even appeared yet ([[negated-assertion-passes-while-absent]]).
  const kpis = (await adminPage.getByTestId('dashboard-kpis').innerText()).trim();
  const pulse = (await adminPage.getByTestId('dash-corpus-pulse').innerText()).trim();
  expect(
    kpis, `KPI 行还在加载,却已经说出 "${kpis.replace(/\n/gu, ' / ')}"`,
  ).not.toMatch(/↑ 0 total|at zero/u);
  // Only assert the **verdict** and the **total** — don't scan the whole card for `^0`: the
  // sparkline's y-axis already has a `0` tick on its own, and a red on that version was really my
  // regex eating the axis label, not the product saying zero again
  // ([[read-the-failure-before-theorising]]).
  expect(
    pulse, `pulse 卡还在加载,却已经说出 "${pulse.replace(/\n/gu, ' / ')}"`,
  ).not.toMatch(/nothing new in 14d/u);
  expect(
    pulse, `总数还没到就该是一个横杠，而这里是 "${pulse.replace(/\n/gu, ' / ')}"`,
  ).toMatch(/—\s*\n?\s*entries · total/u);
  await expect(
    adminPage.getByTestId('pulse-verdict'), '还不知道就别下结论',
  ).toHaveCount(0);
  // "needs your hand" is the single line on this screen most likely to be taken at face value:
  // when it says "nothing needs your attention", the owner really will stop paying attention.
  // While loading, it doesn't know anything yet, and it must not reach that conclusion.
  const needs = (await adminPage.getByTestId('needs-hand').innerText()).trim();
  expect(
    needs, `还在加载就替 owner 判了「没事」："${needs.replace(/\n/gu, ' / ')}"`,
  ).not.toMatch(/nothing pending/iu);

  // The other end: after release it must show the real numbers. Without this half, "render
  // everything as —" would also fool all the assertions above.
  probe.release();
  await expect(
    adminPage.getByTestId('kpi-entries'), '数据到了就得报出来,不能一直挂着 —',
  ).toContainText(/\d/u, { timeout: 15_000 });
}

// usageInFlightIsNotZero — a neighbor of F-L-52 (found in the same sweep).
// `InferenceUsagePanel` never once checks `usage.loading`: `data?.total ?? EMPTY_TOTAL` in
// `use-inference-usage.ts:49` folds "hasn't loaded yet" down to three zeros, so the panel shows
// `0 calls` while still loading, followed by **"no owner-key LLM calls in the last 7 days"** — a
// statement about the world, at a moment when it doesn't actually know anything yet. The owner
// would conclude this instance hasn't spent any money.
async function usageInFlightIsNotZero({ adminPage }: { adminPage: Page }): Promise<void> {
  const probe = hold(adminPage, /\/api\/admin\/inference-usage/);
  void reloadAdminSection(adminPage, 'system'); // same reason as above: force it to fire again
  await expectInjected(probe, 'inference-usage');
  const panel = adminPage.getByTestId('inference-usage-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  const totals = (await adminPage.getByTestId('inference-usage-total').innerText()).trim();
  expect(
    totals, `用量还在路上,面板却已经报出 "${totals.replace(/\n/gu, ' / ')}"`,
  ).not.toMatch(/(^|\s)0(\s|$)/u);
  await expect(
    adminPage.getByTestId('inference-usage-empty'),
    '还没拉到就说「过去 7 天没有调用」—— 那是一句它此刻答不出的话',
  ).toHaveCount(0);

  // The other end: after release this block must give out real numbers (or the genuine empty
  // state) — it may not stay stuck.
  probe.release();
  await expect(
    adminPage.getByTestId('inference-usage-total'), '数据到了就得报出来',
  ).toContainText(/\d/u, { timeout: 15_000 });
}

// sandboxLoadFailure — the most blatant spot in this family: the sandbox panel's empty state
// **explicitly promises the exact thing that isn't true** — "None here means none in use —
// **not that something is broken**." When the GET returns 500, what shows on screen is precisely
// "nothing's broken." The owner would conclude the sandbox is idle, when the truth is they can't
// see any of the workspaces that are actually running.
async function sandboxLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  const probe = fail(adminPage, /\/api\/admin\/sandbox\/workspaces/);
  await reloadAdminSection(adminPage, 'system');
  await expectInjected(probe, 'sandbox workspaces');
  await expect(
    adminPage.getByTestId('sandbox-empty'),
    '拉失败了还说「这里没有就是真没有、不是坏了」—— 这句话此刻正好是反的',
  ).toHaveCount(0);
  await expect(
    // `couldn.t`: the product's actual copy uses a **straight** apostrophe (`Couldn't load this
    // list …`), while this regex used to be written with a curly `'` — a one-character
    // difference, but the red it produced looked like "the product doesn't show a failure notice
    // at all." Don't be strict about the apostrophe position
    // ([[right-bytes-wrong-glyphs]]'s cousin).
    adminPage.getByText(/couldn.t load|could not load|couldn.t reach|could not reach/i).first(),
    'owner 得知道这一块没拉到',
  ).toBeVisible({ timeout: 10_000 });
}

// expectInjected — asserts the request was genuinely intercepted.
async function expectInjected(probe: { hits: () => number }, what: string): Promise<void> {
  await expect.poll(probe.hits, {
    message: `the ${what} GET must actually be intercepted — otherwise this case asserts nothing`,
    timeout: 15_000,
  }).toBeGreaterThan(0);
}

// corpusLoadFailure — RED (before the fix): the catch sets loaded to true and leaves granted
// empty → the card prints "(role grants nothing)". That statement is wrong, and wrong in the
// direction that **reassures** the owner.
async function corpusLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  fail(adminPage, '**/api/admin/codes/*/denials');
  await gotoAdminSection(adminPage, 'codes');
  await expect(adminPage.getByTestId('code-list')).toBeVisible({ timeout: 10_000 });
  await expect(
    adminPage.getByText(GRANTS_NOTHING),
    'the fetch failed — claiming the role grants nothing is a lie, and one the owner would trust',
  ).toHaveCount(0);
}

// corpusLoadFailureIsVisible — merely "not lying" isn't enough: the owner has to know this
// section failed to load, or a piece goes missing from the control panel with no one noticing.
// This asserts **the good outcome** (an error is actually shown), not "didn't crash".
async function corpusLoadFailureIsVisible({ adminPage }: { adminPage: Page }): Promise<void> {
  fail(adminPage, '**/api/admin/codes/*/denials');
  await gotoAdminSection(adminPage, 'codes');
  await expect(adminPage.getByTestId('code-list')).toBeVisible({ timeout: 10_000 });
  await expect(
    adminPage.getByText(/couldn’t load|could not load/i).first(),
    'the owner must be told this control failed to load',
  ).toBeVisible({ timeout: 10_000 });
}

// dashboardCountLoadFailure — the second spot in the same class. The actual swallow lives in
// `dashboard-fetch.ts`'s `if (!res.ok) return 0`: the 500 is never thrown at all, the component's
// catch never sees it, and "0 sent" gets printed just like that.
//
// Asserts **the good outcome** ('—' = didn't load), not "isn't equal to 0" — the latter is
// satisfied before the fetch even returns, and would flip green instantly while the bug is still
// present (that's exactly what the first version of this case did). '—' is only produced by the
// error state; loading shows '…'.
async function dashboardCountLoadFailure({ adminPage }: { adminPage: Page }): Promise<void> {
  let intercepted = 0;
  await adminPage.route(/\/api\/admin\/applications/, (route) => {
    intercepted += 1;
    return route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'boom' } }),
    });
  });
  // Reload the whole page, not "click away and click back". By the time adminPage landed, count
  // had already been fetched once (that request predates the route registration, so it got the
  // real value 0), and Next's client-side routing reuses that segment along with its state — going
  // in a circle still shows that same 0. This case was green once, only because the first request
  // hadn't resolved yet before navigation swept it away; once the codes page got slower (after a
  // picker was mounted), it had enough time to resolve, and the exact same test code started
  // failing red.
  // An assertion whose pass/fail depends on timing is an assertion that will eventually lie.
  // After a reload nothing is left over, and the route is guaranteed to take effect.
  await adminPage.reload();
  // First prove "this request really was pinned to 500". Otherwise a request that never got
  // intercepted would make the assertion fail somewhere entirely unrelated — that's exactly what
  // happened with the first version of this case: it thought it was testing error-swallowing, but
  // it was really testing "this instance happens to have 0 applications".
  await expect.poll(() => intercepted, {
    message: 'the applications GET must actually be intercepted — otherwise this asserts nothing',
  }).toBeGreaterThan(0);
  await expect(
    adminPage.getByTestId('dash-applications-sent'),
    'a failed count must read as unknown (—), never as a confident zero',
  ).toHaveText('—', { timeout: 10_000 });
}

// initOwner — must **genuinely issue a code**: without a code there's no corpus card, and case 1
// would go green while the bug is still present (not finding "(role grants nothing)" would be
// because it was never printed — but because the whole page has no card at all). The first
// version of this spec was falsely green for exactly that reason. The role is also **deliberately
// granted something real** — otherwise "role grants nothing" would happen to be true, and the
// assertion would be worthless.
async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'granted', description: 'grants real corpus', corpus_uris: ['wiki://**'],
  });
  await createCode(request, csrf, {
    code: 'LOADFAIL-001', label: 'loadfail', assumed_role_id: role.id,
  });
  await request.dispose();
}
