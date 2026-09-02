// connector-vendor-spec-assembles.spec.ts -- connector-assembly checks 2 + 3,
// walking the path an owner would actually take.
//
// A real vendor doc's shape (Cal.com v2) is: **an explicit `servers: []`, and
// `components.securitySchemes` also empty**. When this module was driven
// manually, the panel's behavior on these two things was split:
//
//   the auth half got it right -- "this spec declares no authentication — if
//   the API needs a key, pick one below" + three manual schemes + a token box,
//   which the owner can fill in on the spot;
//   the base URL half only says what's missing, with **nowhere on the panel
//   to supply it** (F-C-22). The owner's only way out is to hand-edit the
//   vendor's file -- and the item's own words are "An owner must not have to
//   hand-edit a vendor's file to use it."
//
// And after collecting everything, **there is no submit** (F-C-21): the
// candidate, the scheme, the token are all on screen, but no button turns
// them into a connector. The form that can submit is a different, differently
// shaped one, and by the time you get there all of this is gone.
//
// Both assertions check the **artifact**, not "the click registered":
//   (1) after supplying the base URL, **the candidate actually appears**
//       (not "the error disappeared" -- an empty error != a successful parse);
//   (2) after clicking assemble, `GET /api/admin/connectors` **actually gains
//       a row** (the button's own feedback is not evidence).

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// BASE_URL -- the base URL the owner fills in by hand. Uses a hostname that
// **does not overlap with anything in the spec**, so that "it was actually
// used" is distinguishable later when checking the connector, not a
// coincidental collision.
const BASE_URL = 'https://api.vendor-supplied.test/v2';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a real vendor spec (no servers, no auth) assembles into a connector', () => {
  test.beforeAll(async ({ playwright }) => {
    // resetInstance measured ~48s on a loaded machine (truncating 30 tables
    // takes 22s + unclaim takes 14s), while the hook default only allows 30s.
    // After one test fails, Playwright switches workers, so this hook **runs
    // again** -- and the second test dies right here, looking like its own
    // problem. Give it enough time; don't let environment slowness masquerade
    // as a product failure.
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // F-C-22 -- if it can name what's missing, there must be a place to supply it.
  test('the missing base URL has a place to be supplied, and the candidate then appears',
    async ({ adminPage: page }) => {
      await openConnectorAdd(page);
      await page.getByTestId('connector-spec-input').fill(vendorSpecNoServers());
      await page.getByTestId('connector-spec-submit').click();

      // First prove the rejection actually happened -- otherwise "supplying
      // it fixes things" below might just mean it never needed supplying.
      const err = page.getByTestId('connector-spec-error');
      await expect(err).toContainText(/servers|base url/i);

      await page.getByTestId('connector-spec-base-url').fill(BASE_URL);
      await page.getByTestId('connector-spec-submit').click();

      // Assert the candidate **appears**, not that the error disappears: the
      // latter also holds when the request just dies.
      await expect(page.getByTestId('connector-candidate')).toContainText(/vendor scheduling/i);
      await expect(err).toHaveCount(0);
    });

  // F-C-21 -- the form that has collected everything must be able to submit,
  // and what it submits must be visible elsewhere.
  //
  // This test **deliberately uses a spec that already carries servers**:
  // otherwise it would die first on F-C-22's missing input, so the two guards
  // would prove the same thing, and one breaking would mask the other.
  // Separated out, this test asks only one question --
  // **when nothing needs supplying, can the collected form submit?**
  test('the form that collected spec and scheme can actually assemble a connector',
    async ({ adminPage: page }) => {
      const before = await connectorIDs(page);

      await openConnectorAdd(page);
      await page.getByTestId('connector-spec-input').fill(vendorSpecWithServers());
      await page.getByTestId('connector-spec-submit').click();
      await expect(page.getByTestId('connector-candidate')).toBeVisible();

      // The spec declares no auth -> the panel offers three manual schemes.
      // Pick bearer (that's how a real vendor key would be used).
      await page.getByTestId('connector-scheme-select').selectOption('manual:bearer');

      // First prove **it can't be assembled without checking the box**: no
      // binding (not claiming a category slot) and not exposed to the
      // visitor AI means whatever gets built is unreachable by anyone.
      // Without this half, the green below would only mean "the click
      // registered", not "what got built is usable by anyone".
      await page.getByTestId('connector-assemble-button').click();
      await expect(page.getByTestId('connector-assemble-useless')).toBeVisible();

      // Check "expose to the visitor AI" -- this is the owner's explicit
      // authorization, not something derivable from whether a binding exists.
      await page.getByTestId('connector-expose-agent-tools').check();
      await page.getByTestId('connector-assemble-button').click();

      // The evidence lives in the connector list, not on the button.
      const created = await newConnectorID(page, before);
      expect(created, 'assembling must leave a connector behind').not.toBe('');
    });
});

// ── helpers ────────────────────────────────────────────────────────────────

async function openConnectorAdd(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-connectors').click();
  await page.waitForURL('**/admin/connectors**');
  await page.getByTestId('connector-add-open').click();
  await expect(page.getByTestId('connector-spec-input')).toBeVisible();
}

interface ConnRow { id: string; kind: string }

async function connectorIDs(page: Page): Promise<Set<string>> {
  const res = await page.request.get(`${BACKEND}/api/admin/connectors`);
  if (res.status() !== 200) throw new Error(`list connectors: ${res.status()}`);
  const rows = (await res.json() as { connectors?: ConnRow[] }).connectors ?? [];
  return new Set(rows.map((c) => c.id));
}

// newConnectorID -- polls until an openapi connector appears that wasn't in
// the before snapshot. Identified by "the id that's new", not "the list is
// non-empty" -- the latter is always true when the instance already ships
// built-in connectors.
async function newConnectorID(page: Page, before: Set<string>): Promise<string> {
  let found = '';
  await expect.poll(async () => {
    const res = await page.request.get(`${BACKEND}/api/admin/connectors`);
    if (res.status() !== 200) return false;
    const rows = (await res.json() as { connectors?: ConnRow[] }).connectors ?? [];
    found = rows.find((c) => !before.has(c.id) && c.kind === 'openapi')?.id ?? '';
    return found !== '';
  }, { timeout: 15_000 }).toBe(true);
  return found;
}

// vendorSpecNoServers -- the two traits of a real vendor doc: **an explicit
// empty `servers`** (not a missing field) + no securitySchemes. Cal.com v2's
// openapi.json is exactly this shape ("servers": [] appears at byte 698931).
function vendorSpecNoServers(): string {
  return vendorSpec([]);
}

// vendorSpecWithServers -- the same doc, but with the base URL already in it.
// Used by F-C-21: it wants to ask "can it submit when nothing needs
// supplying", and shouldn't be dragged down by the base-URL gap.
function vendorSpecWithServers(): string {
  return vendorSpec([{ url: BASE_URL }]);
}

function vendorSpec(servers: { url: string }[]): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Vendor Scheduling API', version: '2.0.0' },
    servers,
    paths: {
      '/bookings': {
        get: {
          operationId: 'bookings.list',
          summary: 'List bookings',
          responses: { '200': { description: 'ok' } },
        },
        post: {
          operationId: 'bookings.create',
          summary: 'Create a booking',
          responses: { '201': { description: 'created' } },
        },
      },
    },
  });
}
