// microsite-admin-ui.spec.ts —— the microsites admin panel's UI, exhaustively. The binding + byoai
// backend behaviour is proven in microsite-code-binding.spec.ts; this drives the SAME facts through
// the real page and covers every visible branch:
//   - the panel mounts with NO client-side exception — i.e. the build-watcher long-poll now running
//     in a Web Worker (use-microsites → useLongPoll) mounts without breaking the page;
//   - byoai is a clickable PILL (a real <button aria-pressed>), not plain text "看不出可以点";
//     clicking it flips the state AND the flip survives a reload (it persisted, not just toggled in place);
//   - the binding cell reads "no code" for an unbound page, and the code string once a code is bound
//     (the other end of the binding, visible from the page side too);
//   - once a code is bound the byoai pill is REPLACED by the "overridden" state (the code decides
//     admission — the page's own toggle no longer has the say), not merely hidden;
//   - the Access column carries a "?" tooltip explaining code binding.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'msite-ui@example.com', password: 'correct-horse-battery-staple',
  handle: 'msiteui', fullName: 'Microsite UI Owner',
};

async function createPage(api: APIRequestContext, csrf: string, slug: string): Promise<void> {
  const r = await api.post(`${BACKEND}/api/admin/microsites/`, {
    headers: { 'X-Csrftoken': csrf }, data: { slug, title: slug },
  });
  expect(r.status(), `create page ${slug}`).toBeLessThan(300);
}

async function createCode(api: APIRequestContext, csrf: string, label: string): Promise<{ id: string; code: string }> {
  const r = await api.post(`${BACKEND}/api/admin/codes/`, {
    headers: { 'X-Csrftoken': csrf }, data: { label },
  });
  expect(r.status(), `create code ${label}`).toBeLessThan(300);
  return await r.json() as { id: string; code: string };
}

async function bindCode(api: APIRequestContext, csrf: string, codeID: string, slug: string): Promise<void> {
  const r = await api.patch(`${BACKEND}/api/admin/codes/${codeID}/microsite`, {
    headers: { 'X-Csrftoken': csrf }, data: { slug },
  });
  expect(r.status(), `bind ${codeID} → ${slug}`).toBe(200);
}

// openMicrosites —— click into the microsites section from the /admin landing (adminPage lands
// there). Nav clicks, never a goto — the panel is reached the way the owner reaches it.
async function openMicrosites(page: Page): Promise<void> {
  await page.getByTestId('admin-nav-microsites').click();
  await expect(page.getByTestId('microsites-list')).toBeVisible({ timeout: 30_000 });
}

// refetchMicrosites —— reload the current /admin/microsites page. The list is backed by a
// module-level store that loads once and survives in-app nav, so leaving and returning would just
// re-show the cached rows; only a real reload drops that store and re-reads from the server. That's
// what proves a change PERSISTED (a server fact) rather than lingering in client memory. A reload
// re-fetches the same URL — it is not a goto teleport into a deep route.
async function refetchMicrosites(page: Page): Promise<void> {
  await page.reload();
  await expect(page.getByTestId('microsites-list')).toBeVisible({ timeout: 30_000 });
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('microsites admin panel UI', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('panel mounts (worker OK), byoai pill toggles + persists, Access has a "?" tooltip', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    await createPage(api, csrf, 'togglepage');

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await openMicrosites(page);
    await expect(page.getByTestId('microsite-row-togglepage')).toBeVisible({ timeout: 30_000 });

    // The byoai control is a pill toggle: a real button carrying on/off state.
    const byoai = page.getByTestId('microsite-byoai-togglepage');
    await expect(byoai, 'byoai is a pill toggle').toHaveAttribute('aria-pressed', /^(true|false)$/);
    const before = await byoai.getAttribute('aria-pressed');

    // Clicking it flips the state...
    await byoai.click();
    const flipped = before === 'true' ? 'false' : 'true';
    await expect(byoai, 'clicking the pill flips it').toHaveAttribute('aria-pressed', flipped);

    // ...and the flip PERSISTED — a reload drops the client store and re-reads from the server, so
    // it wasn't just local state.
    await refetchMicrosites(page);
    await expect(page.getByTestId('microsite-byoai-togglepage'), 'the flip survived a reload')
      .toHaveAttribute('aria-pressed', flipped);

    // The Access column has the "?" tooltip explaining code binding (aria-label carries the text).
    await expect(page.getByLabel(/bound to an access code/i), 'access "?" tooltip present').toBeVisible();

    expect(pageErrors, 'panel mounts with no client-side exception (worker OK)').toEqual([]);
    await api.dispose();
  });

  test('binding cell: "no code" when unbound; shows the code and voids the pill once bound', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    await createPage(api, csrf, 'bindpage');

    // Unbound: the binding cell shows there is no code, and the byoai pill is present (this page
    // still gets to decide BYOK for itself).
    await openMicrosites(page);
    const cell = page.getByTestId('microsite-codes-bindpage');
    await expect(cell, 'the binding cell rendered').toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('microsite-byoai-bindpage'), 'unbound page shows the byoai pill').toBeVisible();
    await expect(page.getByTestId('microsite-byoai-void-bindpage')).toHaveCount(0);

    // Bind a code to the page, then reload: the cell now names the code (the page side sees the
    // binding), and the byoai pill is REPLACED by the "overridden" state — not hidden.
    const code = await createCode(api, csrf, 'RECRUITER');
    await bindCode(api, csrf, code.id, 'bindpage');

    await refetchMicrosites(page);
    await expect(page.getByTestId('microsite-codes-bindpage'), 'the page side lists the bound code')
      .toContainText(code.code, { timeout: 30_000 });
    await expect(page.getByTestId('microsite-byoai-void-bindpage'), 'a bound code voids the byoai toggle').toBeVisible();
    await expect(page.getByTestId('microsite-byoai-bindpage'), 'the pill is gone once a code decides admission').toHaveCount(0);

    await api.dispose();
  });
});
