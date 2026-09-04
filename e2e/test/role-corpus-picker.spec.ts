// role-corpus-picker.spec.ts —— corpus admission gets **ticked**, not recited from memory (F-A-14).
//
// Backstory: both the role's grant surface and the code's revocation surface were bare
// textareas — the owner had to remember the scheme plus a note's exact server-side slug
// (`subjectivity://cv`). No discoverability, no validation, a typo fails silently — a
// "silently under-grants" on the authorization side, the same shape of lie as F-A-13:
// both point to "looks fine."
//
// This spec asserts **all the way through** (tick → save → the real value in the DB), not
// "the picker rendered": a picker you can tick but that never saves would look perfect in a
// screenshot.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';
import { BACKEND } from '@/fixtures/vault-sync';

const OWNER = {
  email: 'picker@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'picker',
  fullName: 'Picker Owner',
};

const ROLE = 'pickme';
// PICKER —— the picker instance prefix for this role card. testids are namespaced by
// instance: every card on a page has its own picker, and an unprefixed `scope-genre-wiki`
// would match several at once (that's exactly how the first version went red).
const PICKER = `role-corpus-picker-${ROLE}`;
// FOREIGN —— a glob **no row in the tree corresponds to**. The picker must leave it
// untouched: a picker that round-trips values through translation would silently drop
// whatever the owner hand-wrote when it saves.
const FOREIGN = 'wiki://legacy/*/draft';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });
test.describe('ACL · the corpus grant is picked from the real tree', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('the picker offers every ACL genre — including subjectivity', offersGenres);
  test('ticking a genre writes its glob, and saving it sticks', tickGenreAndSave);
  test('a glob the tree cannot express is kept, not silently dropped', keepsForeignGlobs);
  test('the dock-button picker never offers corpus.retrieval (F-A-8 thesis)',
    dockPickerExcludesRetrieval);
  test('the dock trigger input does not overflow its card (F-A-16 layout)',
    dockTriggerFitsCard);
  test('the help text says WHEN a grant edit takes effect, and says it once',
    helpExplainsTheFreezePoint);
  test('the tree marks each node referable ◆ / not-referable ◇ (B-follow-up)',
    marksReferabilityOnTree);
});

// marksReferabilityOnTree —— the owner (2026-09-03) asked that the scope tree itself say, per
// node, whether that entry is *referable* (`show_as_source`), a separate axis from the read-scope
// checkbox. Seeded: one wiki entry referable, one not. Expanding wiki must render both marks —
// data-referable="true" for one, "false" for the other. RED if the backend stops sending
// show_as_source on the tree (mark absent → count 0) or if the mark isn't wired.
async function marksReferabilityOnTree({ adminPage }: { adminPage: Page }): Promise<void> {
  await openRoles(adminPage);
  await adminPage.getByTestId(`${PICKER}-toggle-wiki`).click();
  const picker = adminPage.getByTestId(PICKER);
  await expect(
    picker.locator('[data-referable="true"]').first(),
    'the referable entry shows the ◆ mark',
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    picker.locator('[data-referable="false"]').first(),
    'the read-but-not-cited entry shows the ◇ mark',
  ).toBeVisible();
}

// helpExplainsTheFreezePoint —— F-L-29. The explanatory sentence contradicted itself:
//   "Changes only affect sessions issued from now on (the role is frozen when the code is issued)."
// The first half says session, the parenthetical says code. The code itself says session
// (`access/usecase/visitor_session.go:40-42`: "frozen at session issue … the session never
// reads the role row again for its whole lifetime"), and the behavior was already pinned
// down (acl-code-frozen-at-issue + acl-code-reissue-reflects in `acl-freeze-isolation.spec.ts`).
//
// **Why one sentence of copy deserves its own guard**: the wrong half is dangerous
// specifically in the direction of **widening** a grant — the owner believes an
// already-issued code keeps its old scope, so they widen the role without worrying about
// codes already in the wild; then the next time someone opens a session with that old code,
// they get the new, wider grant.
//
// This asserts the correct sentence **positively appears**, not `.not.toContain` — the
// latter would also pass before the element ever renders.
async function helpExplainsTheFreezePoint({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'roles');
  const help = adminPage.getByTestId('role-corpus-help').first();
  await expect(help).toBeVisible({ timeout: 10_000 });
  const text = (await help.textContent()) ?? '';
  expect(text, 'the help must name the moment a change lands: session issue')
    .toMatch(/frozen when the session is issued/i);
  expect(text, 'and must not also claim the code freezes it — one sentence, one claim')
    .not.toMatch(/frozen when the code is issued/i);
}

// dockTriggerFitsCard —— F-A-16: the dock config's trigger `<input>` is a flex-1 child with a long
// placeholder; without `min-w-0` a flex item can't shrink below its content, so the input ran off
// the right edge of the role card (owner-flagged live: "it's overflowing"). Assert its right edge
// stays inside the card. RED before the fix: the input overflows by tens of px.
async function dockTriggerFitsCard({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'roles');
  const input = adminPage.getByTestId('role-dock-trigger-0').first();
  await expect(input).toBeVisible({ timeout: 10_000 });
  const overflow = await input.evaluate((el) => {
    const card = el.closest('article') ?? el.parentElement;
    if (!card) return 999;
    return Math.round(el.getBoundingClientRect().right - card.getBoundingClientRect().right);
  });
  expect(overflow, 'the dock trigger input must stay within its role card (min-w-0)')
    .toBeLessThanOrEqual(1);
}

// dockPickerExcludesRetrieval —— F-A-8: a dock button is a visitor ACTION (its trigger is sent as a
// visitor message); `corpus.retrieval` is the AGENT's grounding tool, not something a visitor "does".
// Offering it re-creates exactly the `CorpusSearchBox` F-A-2 deleted (a "search the corpus" visitor
// control violates the thesis — a chat, not a page). The dock cap dropdown must NOT list it, so the
// violation is unbuildable, not merely un-built. RED before the fix: the `<select>` carried
// `<option value="corpus.retrieval">Search the corpus</option>`.
async function dockPickerExcludesRetrieval({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'roles');
  const select = adminPage.getByTestId('role-dock-cap-0').first();
  await expect(select).toBeVisible({ timeout: 10_000 });
  // wait for capabilities to populate the dropdown (a real visitor-action cap shows up)…
  await expect(select.locator('option[value="summarize_conversation"]'))
    .toHaveCount(1, { timeout: 10_000 });
  // …then the grounding tool must be absent — never offerable as a visitor dock button.
  await expect(select.locator('option[value="corpus.retrieval"]')).toHaveCount(0);
}

async function openRoles(page: Page) {
  await gotoAdminSection(page, 'roles');
  await expect(page.getByTestId(PICKER)).toBeVisible({ timeout: 10_000 });
}

// grantOf —— this role's actual current corpus_uris (read back the true value from the owner's own API).
async function grantOf(page: Page): Promise<string[]> {
  return await page.evaluate(async (name: string) => {
    const roles = await (await fetch('/api/admin/roles/', { credentials: 'include' }))
      .json() as Array<{ name: string; corpus_uris: string[] }>;
    return roles.find((r) => r.name === name)?.corpus_uris ?? [];
  }, ROLE);
}

// offersGenres —— subjectivity in particular must be present: the CV lives there, it's the
// whole reason this feature exists, and it never even had a tree before this (F-A-15). A
// picker missing subjectivity is useless for the actual use case.
async function offersGenres({ adminPage }: { adminPage: Page }): Promise<void> {
  await openRoles(adminPage);
  for (const genre of ['wiki', 'output', 'writing', 'subjectivity']) {
    await expect(
      adminPage.getByTestId(`${PICKER}-genre-${genre}`),
      `${genre} is an ACL genre — the picker must offer it`,
    ).toBeVisible();
  }
  // raw is a hardcoded deny (MatchesAnyCorpusGlob's first line); giving it a checkbox would be a lie.
  await expect(adminPage.getByTestId(`${PICKER}-genre-raw`)).toHaveCount(0);
}

// tickGenreAndSave —— all the way through: tick → save → lands in the DB.
async function tickGenreAndSave({ adminPage }: { adminPage: Page }): Promise<void> {
  await openRoles(adminPage);
  expect(await grantOf(adminPage), 'precondition: starts empty').toEqual([]);
  await adminPage.getByTestId(`${PICKER}-genre-subjectivity`).check();
  await adminPage.getByTestId(`role-corpus-save-${ROLE}`).click();
  await expect.poll(
    () => grantOf(adminPage),
    { message: 'the ticked glob must reach the DB, not just the checkbox' },
  ).toContain('subjectivity://**');
}

// keepsForeignGlobs —— an odd glob the owner hand-wrote must not get swallowed by the picker.
// This is the easiest mistake in round-trip translation: writing back only what the tree
// recognizes and letting the rest vanish silently — and it vanishes in the "under-grants"
// direction, which nobody notices right away.
async function keepsForeignGlobs({ adminPage }: { adminPage: Page }): Promise<void> {
  await openRoles(adminPage);
  const box = adminPage.getByTestId(`role-corpus-uris-${ROLE}`);
  await box.fill(`subjectivity://**\n${FOREIGN}`);
  await expect(
    adminPage.getByTestId(`${PICKER}-foreign-globs`),
    'and the owner can SEE that it is still there',
  ).toContainText('legacy');
  // Tick a different one — an operation that rewrites the whole list at once.
  await adminPage.getByTestId(`${PICKER}-genre-wiki`).check();
  await adminPage.getByTestId(`role-corpus-save-${ROLE}`).click();
  await expect.poll(
    () => grantOf(adminPage),
    { message: 'a hand-written glob must survive a picker interaction' },
  ).toContain(FOREIGN);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  await createRole(request, csrf, { name: ROLE, description: 'picker target', corpus_uris: [] });
  await seedNote(request, csrf);
  await request.dispose();
}

// seedNote —— there has to be something real in the tree to tick (an empty tree would also
// make "can't tick anything" look like it passed). Two wiki entries with opposite referability
// so the tree's per-node referability mark (◆/◇) has both states to prove out.
async function seedNote(
  request: Awaited<ReturnType<Playwright['request']['newContext']>>, csrf: string,
): Promise<void> {
  await request.post(`${BACKEND}/api/admin/corpus/wiki`, {
    headers: { 'X-Csrftoken': csrf },
    data: { title: 'Thinking', body: 'A curated fact.', tags: ['node'], show_as_source: true },
  });
  await request.post(`${BACKEND}/api/admin/corpus/wiki`, {
    headers: { 'X-Csrftoken': csrf },
    data: { title: 'Persona', body: 'Read but never cited.', tags: ['node'], show_as_source: false },
  });
}
