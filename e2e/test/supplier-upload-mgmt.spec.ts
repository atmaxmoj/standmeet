// supplier-upload-mgmt.spec.ts — #155 area G (upload/manage) RED contract.
//
// Story: a self-hosting owner can upload a **custom spec + binding** on their own
// instance's UI (decision §7.4, "the owner can upload on their own instance UI, no
// central review"). It lands in the suppliers list, can be assembled, and is
// distinguished from built-in suppliers; a duplicate name triggers an overwrite
// confirmation; after deleting an uploaded supplier, the category cap it filled
// **re-gates** (the consumer's Requires is no longer satisfied → that cap row drops
// from available back to hidden/gated).
//
// Aligned with docs/design/supplier.md §8 area G + the target interface sketch:
//   testid: supplier-add-open / supplier-spec-input / supplier-binding-input /
//           supplier-spec-submit / supplier-row-{category} / supplier-origin-badge /
//           supplier-overwrite-confirm / supplier-delete-button / supplier-status
//   REST:   POST /api/admin/suppliers (build from spec) / DELETE /api/admin/suppliers/{id}
//
// Covers §8 area G upload/manage UI + backend. Implemented, green (was a RED
// contract, turned green once implemented).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('supplier · area G upload / manage', () => {
  // Covers the self-hosted spec+binding upload/manage UI (docs/design/supplier.md
  // §8 area G). Implemented, green.

  // Reset the instance + owner for every test (suppliers must not accumulate
  // across tests; overwrite/delete assertions need clean absolute state).
  test.beforeEach(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // happy — upload a custom spec + binding → the calendar row appears in the list →
  // it's assemblable (has a status).
  test('upload a custom spec+binding → calendar row appears → assemblable', async ({ adminPage: page }) => {
    await uploadSupplier(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('supplier-row-calendar');
    await expect(row).toBeVisible();
    // Assembly landed: status reads not connected while nothing is wired up yet.
    await expect(row.getByTestId('supplier-status')).toContainText(/not connected|未连接/i);
  });

  // happy — an uploaded supplier carries the "uploaded" origin badge, distinguishing
  // it from a built-in one.
  test('uploaded vs built-in: an uploaded supplier carries the uploaded origin badge', async ({ adminPage: page }) => {
    await uploadSupplier(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('supplier-row-calendar');
    const badge = row.getByTestId('supplier-origin-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/uploaded|自定义|上传/i);
    await expect(badge).not.toContainText(/built-?in|内置/i);
  });

  // err/edge — uploading a duplicate name → an overwrite confirmation pops up; after
  // confirming, only one row remains for that category (overwrite, not stacking).
  test('duplicate-name upload → overwrite confirm → list not duplicated', async ({ adminPage: page }) => {
    await uploadSupplier(page, validCalendarSpec(), calendarBinding());
    // Upload another calendar supplier of the same category → hits the duplicate.
    await openSupplierAdd(page);
    await fillSpecAndBinding(page, validCalendarSpec(), calendarBinding());
    await assembleFilledSpec(page);

    const confirm = page.getByTestId('supplier-overwrite-confirm');
    await expect(confirm).toBeVisible();
    await confirm.click();

    // Overwritten: the calendar row count stays at one.
    await expect(page.getByTestId('supplier-row-calendar')).toHaveCount(1);
  });

  // happy — deleting an uploaded supplier → it disappears from the list, and the
  // calendar cap it filled re-gates (hidden/gated).
  test('delete an uploaded supplier → row gone + calendar cap re-gated/hidden', async ({ adminPage: page }) => {
    await uploadSupplier(page, validCalendarSpec(), calendarBinding());

    const row = page.getByTestId('supplier-row-calendar');
    await expect(row).toBeVisible();
    await row.getByTestId('supplier-delete-button').click();
    // Confirm the delete (a destructive action).
    await page.getByRole('button', { name: /delete|remove|删除|确认/i }).click();

    // Row gone.
    await expect(page.getByTestId('supplier-row-calendar')).toHaveCount(0);
    // Cap re-gated: the block that depends on calendar (booker calendar.book)
    // drops back to gated/hidden.
    // Currently block-row-calendar.book only unlocks once connected; deleting
    // the provider re-gates it.
    const capRow = page.getByTestId('block-row-calendar.book');
    await expect(capRow).toHaveCount(0);
  });

  // Invariant — a built-in supplier (embedded data) cannot be deleted/edited by the
  // owner: DELETE/PUT a built-in id → 409 builtin_readonly.
  // Guards that "ErrBuiltinReadonly is distinct from ErrInvalidManifest": editing a
  // built-in must be 409, not a "bad manifest" 400.
  test('built-in supplier is read-only: delete/edit a built-in → 409', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await login(request, OWNER.email, OWNER.password);
    // google-calendar is a built-in supplier (builtins/data/google-calendar,
    // embedded into the binary).
    // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: DELETE a built-in supplier must be refused 409 builtin_readonly
    const del = await request.delete(`${BACKEND}/api/admin/suppliers/google-calendar`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect(del.status(), 'DELETE a built-in supplier → 409 builtin_readonly').toBe(409);
    // eslint-disable-next-line e2e-local/no-direct-mutating-api -- action under test: PUT (edit) a built-in supplier must be refused 409 builtin_readonly
    const put = await request.put(`${BACKEND}/api/admin/suppliers/google-calendar`, {
      headers: { 'X-Csrftoken': csrf },
      data: { spec: JSON.parse(validCalendarSpec()), binding: calendarBinding() },
    });
    expect(put.status(), 'PUT (edit) a built-in supplier → 409 builtin_readonly').toBe(409);
    await request.dispose();
  });

  // F-C-47 — **it uploads fine, but there's no way to connect it.**
  //
  // (1)🔴 Real environment (prod): a protocol(caldav) supplier was built via owner
  // MCP, and it does show up under "SUPPLIERS YOU UPLOADED" in the admin — one row,
  // `calendar [uploaded] [protocol] · not connected` plus a `×`, **and that's it**.
  // No credential fields, no CONNECT, nothing clickable.
  // Yet this section's own lead-in text says *"you can upload your own (OpenAPI /
  // protocol) supplier"*.
  //
  // (2)🎯 Checked all three places: `CatalogCards` only renders from
  // `/suppliers/catalog` (just the three built-ins); `SupplierList.SupplierRowItem`
  // only draws category/origin/kind/status/delete; owner MCP has no op for storing
  // credentials either. **But the backend is fully wired** — `/{id}/credential-form`,
  // `/{id}/credentials`, `/{id}/connect` are all mounted under the `/{id}` group, and
  // work for any id. What's missing isn't the block, it's a surface that wires it
  // out to the UI ([[button-that-cannot-be-wired]]).
  //
  // The assertion must be able to fail: don't just assert "a form exists" (an empty
  // form would also pass) — assert **a field derived from this spec's own auth
  // scheme**, which can only come from the credential form the backend computed for
  // this supplier.
  test('an uploaded supplier can be given credentials, not just listed (F-C-47)',
    ({ adminPage: page }) => uploadedRowTakesCredentials(page));

  // F-C-56: **a supplier with no bound category has no name in the list.**
  //
  // The card name always renders `category`, and a vendor like GitHub that doesn't
  // map to calendar/mail has only one path — "expose as an agent tool" — and that
  // path never produces a category, so it ends up in "SUPPLIERS YOU UPLOADED" as a
  // row that's an empty box carrying only the `uploaded` and `openapi` badges.
  // The moment a second one is uploaded, the list stops being readable: which row
  // needs credentials filled in, which one to delete — the screen can't answer.
  //
  // The assertion must be able to fail: don't just assert "there's text" (the
  // `uploaded` badge is also text) — assert **this spec's own `info.title`** — that
  // exact string can only come from this document.
  test('an uploaded supplier with no category still says which vendor it is (F-C-56)',
    ({ adminPage: page }) => uncategorisedRowNamesTheVendor(page));
});

// uncategorisedRowNamesTheVendor — upload a spec with **no binding**, expose checked
// (the only path that works for a GitHub-style vendor), then check what it's called
// in the list.
async function uncategorisedRowNamesTheVendor(page: Page): Promise<void> {
  await openSupplierAdd(page);
  await expect(page.getByTestId('supplier-spec-input')).toBeVisible();
  await page.getByTestId('supplier-spec-input').fill(validCalendarSpec());
  // Leave the binding empty + check "expose to visitor AI" — no binding and unchecked
  // gets rejected by the product (needsBindingOrExpose).
  await page.getByTestId('supplier-spec-submit').click();
  await expect(page.getByTestId('supplier-candidate')).toBeVisible();
  await page.getByTestId('supplier-expose-agent-tools').check();
  await page.getByTestId('supplier-assemble-button').click();
  // If assembly was rejected, the "row not found" assertion below would go red in a
  // way that looks identical to the real defect — read the actual rejection first.
  await expect(page.getByTestId('supplier-assemble-error')).toHaveCount(0);
  await expect(page.getByTestId('supplier-assemble-useless')).toHaveCount(0);
  await page.getByTestId('supplier-modal-close').click();

  // No category → the row's testid has an empty suffix. This is the same root cause:
  // two category-less suppliers would collide on the same testid.
  const row = page.getByTestId('supplier-row-');
  await expect(row).toBeVisible();
  await expect(
    row.getByTestId('supplier-card-name'),
    'an uploaded supplier with no category must still name its vendor',
  ).toHaveText('Acme Calendar');
}

// uploadedRowTakesCredentials — upload a supplier, then find where to fill in
// credentials for it on the same page.
async function uploadedRowTakesCredentials(page: Page): Promise<void> {
  await uploadSupplier(page, validCalendarSpec(), calendarBinding());

  const row = page.getByTestId('supplier-row-calendar');
  await expect(row).toBeVisible();

  // Asserts the two things a built-in card actually renders (`supplier-field-*` +
  // CONNECT) — my first version asserted `supplier-cred-form`, a testid that lives in
  // a different, older component and **the built-in card doesn't have it either**, so
  // the fix still went red for a reason nobody could point to
  // ([[read-the-failure-before-theorising]]).
  // client_id can only come from the form derived from **this spec's own declared
  // oauth2 scheme** — asserting a specific field means an empty form can't pass.
  await expect(
    row.getByTestId('supplier-field-client_id'),
    'an uploaded supplier must take credentials, not just be listed and deleted',
  ).toBeVisible();
  await expect(
    row.getByTestId('supplier-connect-button'),
    'and there must be somewhere to press once they are filled in',
  ).toBeVisible();
}

// ──────────────────────────────────────────────────────────────────────────
// Local helpers (to be promoted into a shared fixture once implemented:
// openSupplierAdd / uploadSupplier + the sample spec / binding strings).
// ──────────────────────────────────────────────────────────────────────────

// openSupplierAdd — navigates into the suppliers area via the known entry point and
// opens add (no page.goto).
async function openSupplierAdd(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-suppliers').click();
  await page.waitForURL('**/admin/suppliers**');
  await page.getByTestId('supplier-add-open').click();
}

// fillSpecAndBinding — pastes the spec into spec-input and the binding into
// binding-input.
async function fillSpecAndBinding(
  page: Page, spec: string, binding: string,
): Promise<void> {
  await expect(page.getByTestId('supplier-spec-input')).toBeVisible();
  await page.getByTestId('supplier-spec-input').fill(spec);
  await page.getByTestId('supplier-binding-input').fill(binding);
}

// uploadSupplier — opens add → fills spec+binding → **validate → assemble** → waits
// for that category's row to appear in the list.
//
// Validate and assemble are now two separate actions (F-C-21): `supplier-spec-submit`
// only validates (produces candidates + a derived credential form),
// `supplier-assemble-button` is what creates the supplier. These two used to be
// crammed onto one button, and which one it did depended on whether the binding box
// was empty — one button, two meanings, exactly why an owner with a real vendor spec
// used to hit a dead end.
async function uploadSupplier(
  page: Page, spec: string, binding: string,
): Promise<void> {
  await openSupplierAdd(page);
  await fillSpecAndBinding(page, spec, binding);
  await assembleFilledSpec(page);
  // The modal **stays open** after assembly (the form gives way to the new
  // supplier's card: credentials + Connect live there). This test only cares
  // whether it landed in the list, so it closes the modal itself — the area's main
  // body doesn't render while the modal is open.
  await page.getByTestId('supplier-modal-close').click();
  await expect(page.getByTestId('supplier-row-calendar')).toBeVisible();
}

// assembleFilledSpec — form is already filled → validate → wait for a candidate →
// assemble. **Does not close the modal**: on the duplicate-name path the modal gives
// way on its own to the overwrite confirmation (a pending question takes priority
// over the modal), and clicking close here would hit nothing.
async function assembleFilledSpec(page: Page): Promise<void> {
  await page.getByTestId('supplier-spec-submit').click();
  await expect(page.getByTestId('supplier-candidate')).toBeVisible();
  await page.getByTestId('supplier-assemble-button').click();
}

// validCalendarSpec — a minimal valid OpenAPI 3.0 calendar spec (servers + freebusy +
// events.insert operation + oauth2 securityScheme).
function validCalendarSpec(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Acme Calendar', version: '1.0.0' },
    servers: [{ url: 'https://calendar.acme.test/v1' }],
    paths: {
      '/freebusy': {
        post: {
          operationId: 'freebusy.query',
          security: [{ oauth2: ['calendar.read'] }],
          responses: { '200': { description: 'ok' } },
        },
      },
      '/events': {
        post: {
          operationId: 'events.insert',
          security: [{ oauth2: ['calendar.write'] }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://calendar.acme.test/oauth/authorize',
              tokenUrl: 'https://calendar.acme.test/oauth/token',
              scopes: { 'calendar.read': 'read', 'calendar.write': 'write' },
            },
          },
        },
      },
    },
  });
}

// calendarBinding — the op→contract binding (YAML text), mapping list_busy/create_event
// to freebusy.query / events.insert, with request/response in JSONata (decision §7.1).
function calendarBinding(): string {
  return [
    'seam: calendar',
    'kind: openapi',
    'operations:',
    '  list_busy:',
    '    op: freebusy.query',
    '    request: { timeMin: timeMin, timeMax: timeMax }',
    '    response: { busy: calendars.primary.busy }',
    '  create_event:',
    '    op: events.insert',
    '    request: { summary: title, start: { dateTime: start }, end: { dateTime: end } }',
    '    response: { id: id, url: htmlLink }',
  ].join('\n');
}
