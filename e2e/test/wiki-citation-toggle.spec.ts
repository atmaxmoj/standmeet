// wiki-citation-toggle.spec.ts — citation (show_as_source) is under the owner's control,
// and **an edit must not silently change it**.
//
// Two orthogonal knobs, and the UI must let the owner tell them apart (CorpusEntryForm's
// CitableField exists precisely to explain this):
//   read      — can the AI pull this into context -> the role/code's corpus URI
//               (/admin/roles, narrowed per code)
//   citation  — does the answer list it as a source at the end -> this note's show_as_source
// Turning citation off does NOT mean hiding it: the AI still reads it, still uses it to
// compose the answer, it's just not attributed.
//
// **The real bug (why this spec exists)**: `toEntryInput` sends {title, body, tags,
// parent_id} — which does not include show_as_source. Go's `ShowAsSource bool`, receiving
// nothing, decodes to false and writes it to the store as-is. So editing the body in
// admin **silently turns off** this entry's citation switch: no error, no warning.
//
// So this spec **must drive the real form**. My first version hit the backend PATCH
// directly, carrying show_as_source itself — that stayed green whether the bug was fixed
// or not, because the bug was never in the backend: that's "testing one layer below where
// the gap actually is", the same trap this audit round kept falling into.

import { test, expect } from '@/fixtures/test';
import type { Locator, Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'citation@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'citation',
  fullName: 'Citation Owner',
};

const TITLE = 'Citable Wiki Entry';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
// serial: these three cases **share one entry** (case 1 creates it, 2/3 edit it), and
// beforeAll's resetInstance runs **once per worker** — under parallel execution, a
// later-starting worker wipes the instance the earlier one was still using. That's
// exactly what happened the first time this ran: case 3 couldn't find its row, because
// another worker had already reset wiki to an empty list (the backend log showed
// GET /corpus/wiki returning `[]`). Shared mutable instance + parallel workers = a false red.
test.describe.configure({ mode: 'serial' });
test.describe('corpus · citation is owner-controlled and survives an edit', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('the form explains citation and defaults it on', citableDefaultsOnAndIsExplained);
  test('editing the body does NOT silently turn citation off', editPreservesCitation);
  test('editing the body does NOT move the note to the root', editPreservesParent);
  test('the owner can turn citation off from the form, and it sticks', ownerCanTurnOff);
  test('opening the form fetches the entry ONCE, not in a loop', opensWithoutARequestStorm);
});

// opensWithoutARequestStorm — F-A-17. useWikiDetail's effect depends on the entire
// `actions` object, and use-corpus-actions builds a fresh object literal on every render;
// fetchDetail itself calls setPending -> re-render -> new object -> effect re-runs ->
// fetch again: an infinite loop. The backend log showed the same GET fired every 6ms.
//
// And it **masquerades as still loading**: on every cleanup, `alive` gets set to false
// before the promise resolves, so setDetail never runs even once, and the form stays
// stuck on loading… forever. The owner would only perceive this as "slow". This asserts
// the request count, because the bug's real substance is the request count itself.
async function opensWithoutARequestStorm({ adminPage }: { adminPage: Page }): Promise<void> {
  let hits = 0;
  await adminPage.route(/\/api\/admin\/corpus\/wiki\/[0-9a-f-]{36}$/, (route) => {
    hits += 1;
    return route.continue();
  });
  const form = await openEditForm(adminPage, TITLE);
  // Wait for a definite signal (the form is actually interactive), not a wall clock. If
  // the loop is still there, just getting to this line already fired hundreds of
  // requests — in fact, while the loop persists, openEditForm never even reaches loaded,
  // so this count means "even if it manages to load, it still isn't allowed to spin".
  await expect(form.citable).toBeVisible();
  expect(hits, 'the lazy detail fetch must fire once per open, not spin').toBeLessThanOrEqual(2);
}

// citationOf — this note's current show_as_source (reads back the real value from the
// owner's own admin API).
async function citationOf(page: Page, title: string): Promise<boolean | undefined> {
  return await page.evaluate(async (t: string) => {
    const list = await (await fetch('/api/admin/corpus/wiki?limit=100', {
      credentials: 'include',
    })).json() as Array<{ id: string; title: string }>;
    const row = list.find((w) => w.title === t);
    if (!row) return undefined;
    const d = await (await fetch(`/api/admin/corpus/wiki/${row.id}`, {
      credentials: 'include',
    })).json() as { show_as_source?: boolean };
    return d.show_as_source;
  }, title);
}

// EditForm — the real testid shape of a wiki row's edit form (copied from the prod GUI,
// not guessed): the row is `wiki-row-${id}`, its button is `wiki-edit-${id}`, the
// expanded form's field prefix is `wiki-edit-form-${id}-`, and `wiki-edit-loaded-${id}`
// is the "loaded" marker — the form is **lazy-loaded** (showing loading… when first
// opened), so this marker must be waited for; don't proceed the moment a field becomes visible.
interface EditForm {
  citable: Locator;
  body: Locator;
  submit: Locator;
}

// expandParentID — the list is a **tree**: only root entries are visible directly, and a
// child needs the parent's `▸` expanded before it renders at all. Skip this step and
// looking for a child row waits until timeout, with a failure that looks like "this entry
// was never created at all".
async function openEditForm(
  page: Page, title: string, expandParentID?: string,
): Promise<EditForm> {
  await gotoAdminSection(page, 'wiki');
  if (expandParentID !== undefined) {
    await page.getByTestId(`tree-toggle-wiki-row-${expandParentID}`).click();
  }
  // `.last()`: in the tree, a parent row **contains** its child row, so hasText hits
  // both. What's needed is the innermost one — grabbing the parent row instead would
  // click the parent's edit button, editing the wrong note while the test stays green.
  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: title }).last();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const id = (await row.getAttribute('data-testid'))!.replace('wiki-row-', '');
  await page.getByTestId(`wiki-edit-${id}`).click();
  // Lazy-loaded: wait for the form to really be in place, otherwise the fill below hits
  // a field that hasn't rendered yet.
  await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
  return {
    citable: page.getByTestId(`wiki-edit-form-${id}-citable`),
    body: page.getByTestId(`wiki-edit-form-${id}-body`),
    submit: page.getByTestId(`wiki-edit-form-${id}-submit`),
  };
}


// citableDefaultsOnAndIsExplained — a new entry is citable by default (matches the DB's
// `NOT NULL DEFAULT true`), and the UI must **explain** what this checkbox means — an
// owner facing a checkbox with no context will only guess wrong.
async function citableDefaultsOnAndIsExplained({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'wiki');
  await adminPage.getByTestId('wiki-new-btn').click();
  await adminPage.getByTestId('wiki-create-title').fill(TITLE);
  await adminPage.getByTestId('wiki-create-body').fill('A curated fact worth citing.');
  const citable = adminPage.getByTestId('wiki-create-citable');
  await expect(citable, 'the form offers the citation control').toBeVisible();
  await expect(citable, 'and it defaults ON, matching the DB default').toBeChecked();
  // The explanation must be present: read vs. cite are two different things, and without
  // this sentence the owner would think turning it off means hiding it. The copy is
  // i18n'd (corpus.citable.help) — what's asserted is the rendered sentence, not the key:
  // it's the sentence the owner actually reads.
  await expect(adminPage.getByText(/still reads this note/)).toBeVisible();
  await adminPage.getByTestId('wiki-create-submit').click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
  expect(await citationOf(adminPage, TITLE), 'new entry is citable').toBe(true);
}

// editPreservesCitation — THE BUG, driving the real form: edit only the body and save,
// the citation switch must not move.
// RED (before the fix): the form doesn't send show_as_source -> Go decodes it as false ->
// this entry silently becomes non-citable.
async function editPreservesCitation({ adminPage }: { adminPage: Page }): Promise<void> {
  const form = await openEditForm(adminPage, TITLE);
  await expect(form.citable, 'precondition: this entry starts citable').toBeChecked();
  // Touch only the body. Never touch the citation checkbox at all — exactly what an
  // owner would actually do.
  await form.body.fill('An edited fact, still worth citing.');
  await form.submit.click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
  expect(
    await citationOf(adminPage, TITLE),
    'editing the body must not flip citation off — the owner never touched that control',
  ).toBe(true);
}

// CHILD — the child entry used by editPreservesParent. Kept separate from TITLE: it needs
// to be filed under something else.
const CHILD = 'A Child Of The Citable Entry';

// parentOf — this note's current parent_id (reads back the real value from the owner's
// own admin API).
async function parentOf(page: Page, title: string): Promise<string | null | undefined> {
  return await page.evaluate(async (t: string) => {
    const list = await (await fetch('/api/admin/corpus/wiki?limit=100', {
      credentials: 'include',
    })).json() as Array<{ id: string; title: string }>;
    const row = list.find((w) => w.title === t);
    if (!row) return undefined;
    const d = await (await fetch(`/api/admin/corpus/wiki/${row.id}`, {
      credentials: 'include',
    })).json() as { parent_id?: string | null };
    return d.parent_id ?? null;
  }, title);
}

// editPreservesParent — F-L-28. **The same shape as the bug above, occurring a second
// time**: the edit form zeroes out a field it never even displays. `corpus_write.go`'s
// `ParentID` is a bare `string`, so "this field is absent from the request" and
// "explicitly move it to the root" collapse into the same value; and the edit form's
// `initial` has no parent_id at all, and no ParentSlot.
//
// **Why this matters more than "the citation switch got flipped off"**: the tree is the
// corpus's address space. `uriOf` = `genre://<path>`, and a role/code's ACL glob is
// written against that exact path. Once a note gets knocked to the root, its URI
// changes — the owner's `wiki://a/b/**` no longer contains it, and the screen says
// nothing about it at all.
//
// RED (before the fix): a single body-only save moves parent_id from the parent's id to null.
async function editPreservesParent({ adminPage }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(adminPage, 'wiki');
  // The parent dropdown's **label** is `path ?? title` (CorpusEntryForm.tsx:26), not the
  // title itself — picking by title would fail to find that option. Pick by id instead,
  // read off the row's testid (the same route as openEditForm).
  const parentRow = adminPage.locator('[data-testid^="wiki-row-"]', { hasText: TITLE });
  await expect(parentRow).toBeVisible({ timeout: 10_000 });
  const parentID = (await parentRow.getAttribute('data-testid'))!.replace('wiki-row-', '');
  await adminPage.getByTestId('wiki-new-btn').click();
  await adminPage.getByTestId('wiki-create-title').fill(CHILD);
  await adminPage.getByTestId('wiki-create-body').fill('A fact that lives under another one.');
  // File it under the TITLE entry — picked via the real form's parent selector, not
  // pushed in through the API.
  await adminPage.getByTestId('wiki-create-parent').selectOption(parentID);
  await adminPage.getByTestId('wiki-create-submit').click();

  // Wait for it to really persist (the child entry is collapsed under its parent in the
  // list and not visible — wait for the API's real value, not for an element that never appears).
  await expect.poll(
    () => parentOf(adminPage, CHILD), { timeout: 10_000 },
  ).toBe(parentID);
  // The precondition itself needs to be able to fail: if picking the parent didn't take
  // effect, the assertion below would degrade to "null equals null" and stay green
  // forever.
  const before = await parentOf(adminPage, CHILD);
  expect(before, 'precondition: the child really was created under a parent').not.toBeNull();

  const form = await openEditForm(adminPage, CHILD, parentID);
  await form.body.fill('An edited fact that still lives under the same parent.');
  await form.submit.click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });

  expect(
    await parentOf(adminPage, CHILD),
    'editing the body must not re-parent the note — the form never showed that control',
  ).toBe(before);
}

// ownerCanTurnOff — the control genuinely goes all the way through: uncheck -> save ->
// persists.
async function ownerCanTurnOff({ adminPage }: { adminPage: Page }): Promise<void> {
  const form = await openEditForm(adminPage, TITLE);
  await form.citable.uncheck();
  await form.submit.click();
  await expect(adminPage.getByText(TITLE).first()).toBeVisible({ timeout: 5_000 });
  expect(await citationOf(adminPage, TITLE), 'the owner turned citation off').toBe(false);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  await request.dispose();
}
