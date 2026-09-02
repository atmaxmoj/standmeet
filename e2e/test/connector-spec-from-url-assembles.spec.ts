// connector-spec-from-url-assembles.spec.ts —— F-C-25 + F-C-26.
//
// Both were driven out on prod using Cal.com's own real published docs, and they survived
// this long because **there was no e2e covering the happy path of "fetch a spec from a
// URL"**: the two existing test cases that touch fetching both exercise failure scenarios
// (unreachable / blocked by egress policy), so whether "the fetched document can actually
// be assembled into a connector" was never walked by anyone.
//
// F-C-25 — the candidate is fetched fine, but assemble sends an **empty spec** (the body
// only ever existed in that one backend fetch).
// F-C-26 — when assemble fails, the modal shows **not a single word**; the form just sits
// there as if the click never happened.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// SPEC_URL / BASE_URL —— both point at external-mock: the backend (not the browser) does the
// fetching, so it must be an address reachable inside the container; it's also listed in
// CONNECTOR_EGRESS_ALLOW, which is what lets the assemble-time egress static check pass.
const SPEC_URL = 'http://external-mock:9000/vendor-openapi/no-servers.json';
// TOO_BIG_SPEC_URL —— valid JSON, just bigger than what this instance accepts (in the real
// world, GitHub's 12 MB doc is exactly this case).
const TOO_BIG_SPEC_URL = 'http://external-mock:9000/vendor-openapi/too-big.json';
const BASE_URL = 'http://external-mock:9000';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('a spec fetched from a URL can actually be assembled', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000); // resetInstance can take ~48s under load, and the hook default is only 30s
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  // F-C-25 —— the whole real journey: fetch → get refused with a named reason → supply the
  // base URL → get a candidate → assemble → an actual new row shows up in the list.
  test('fetch by URL → supply the base URL → assemble leaves a connector behind',
    async ({ adminPage: page }) => {
      const before = await connectorIDs(page);
      await openConnectorAdd(page);

      await page.getByTestId('connector-spec-url-input').fill(SPEC_URL);
      await page.getByTestId('connector-spec-fetch-button').click();
      // First prove the refusal actually happened — otherwise "supplying it fixes things"
      // below might just mean it never needed to be supplied in the first place.
      await expect(page.getByTestId('connector-spec-error')).toContainText(/servers|base url/i);

      await page.getByTestId('connector-spec-base-url').fill(BASE_URL);
      await page.getByTestId('connector-spec-fetch-button').click();
      await expect(page.getByTestId('connector-candidate')).toContainText(/vendor scheduling/i);

      await page.getByTestId('connector-scheme-select').selectOption('manual:bearer');
      await page.getByTestId('connector-field-token').fill('vendor-test-token');
      // No binding → the owner must explicitly expose it to the visitor AI, otherwise once
      // assembled nobody can call it (see isAssemblable).
      await page.getByTestId('connector-expose-agent-tools').check();
      await page.getByTestId('connector-assemble-button').click();

      // The evidence lives in the connector list, not on the button.
      expect(await newConnectorID(page, before), 'a URL-fetched spec must assemble')
        .not.toBe('');
    });

  // F-C-52 —— **the fetched document is too large, and the product claims it's "malformed".**
  //
  // ①🔴 Hit in the real environment: paste **GitHub's own published** `api.github.com.json`
  // (12 MB, valid JSON) into the URL field → the product responds *"could not parse the spec
  // (invalid JSON or YAML)"*. The owner goes looking for a syntax error that doesn't exist.
  //
  // ②🎯 An off-by-one boundary: `svc_validate.go`'s `io.LimitReader(resp.Body, MaxSpecBytes)`
  // reads **exactly up to the limit**, so `len(raw) > MaxSpecBytes` never comes out true, and
  // the correct message (the one the paste path has been using all along — "spec is too
  // large (over the 2 MiB size limit)") **can never be spoken** on this path — all that's
  // left is a parse failure at the truncation point.
  //
  // The criterion must be falsifiable: it's not enough to say "too large", it must **also
  // never say "invalid JSON"** — which is exactly what it used to say.
  test('a fetched spec that is merely too large says so, not "invalid JSON" (F-C-52)',
    async ({ adminPage: page }) => {
      await openConnectorAdd(page);
      await page.getByTestId('connector-spec-url-input').fill(TOO_BIG_SPEC_URL);
      await page.getByTestId('connector-spec-fetch-button').click();

      const said = page.getByTestId('connector-spec-error');
      await expect(said, 'it has to name the size').toContainText(/too large|size limit/i);
      await expect(
        said, 'a valid document that is merely oversized is not malformed',
      ).not.toContainText(/invalid json|could not parse/i);
    });

  // F-C-26 —— an assemble failure must be stated **inside the modal**. A binding with a
  // category that doesn't exist manufactures a real backend refusal: the spec itself is
  // valid (validation passes, a candidate appears), but at connector-creation time the
  // category doesn't resolve to any adapter.
  test('a refused assemble says so inside the modal', async ({ adminPage: page }) => {
    await openConnectorAdd(page);

    await page.getByTestId('connector-spec-input').fill(specWithServers());
    await page.getByTestId('connector-binding-input').fill(bindingUnknownCategory());
    await page.getByTestId('connector-spec-submit').click();
    await expect(page.getByTestId('connector-candidate')).toBeVisible();

    await page.getByTestId('connector-assemble-button').click();

    // Assert on **the text visible inside the modal**. A page-level toast doesn't count:
    // the modal covers the whole page, so the owner never sees it.
    const err = page.getByTestId('connector-assemble-error');
    await expect(err).toBeVisible();
    const shown = await err.innerText();
    expect(shown.trim().length, 'the refusal must actually say something').toBeGreaterThan(0);
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

// specWithServers — valid and carries its own base URL: what this test asks is "does the
// failure get stated", and it shouldn't get entangled with the base-URL question.
function specWithServers(): string {
  return JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Refusable API', version: '1.0.0' },
    servers: [{ url: BASE_URL }],
    paths: {
      '/v2/bookings': {
        get: { operationId: 'bookings.list', responses: { '200': { description: 'ok' } } },
      },
    },
  });
}

// bindingUnknownCategory — the category names a contract that doesn't exist → at assemble
// time it resolves to no adapter, and the backend refuses.
function bindingUnknownCategory(): string {
  return [
    'category: telepathy',
    'operations:',
    '  list_slots:',
    '    op: bookings.list',
    '    response: "$"',
    '',
  ].join('\n');
}
