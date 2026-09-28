// transcript-ghost-shown.spec.ts — "shown" in the owner's ghost log means the visitor saw it,
// and a ghost the visitor saw three times reads as one line, not three.
//
// Owner report (2026-09-28): the transcript's "ghost text shown" list held six identical
// lines of the same initial ghost, for a visitor who entered through a code bound to a
// microsite — a path where the chat input that carries the ghost is never on screen.
//
// Mechanism (read from the code): app/src/lib/page/use-ghost-logger.ts posts "shown" the
// moment a ghost is written into the store (the initial ghost is seeded on page load), not
// when it is visible; and its dedup lives in the in-memory store, so every page load posts
// the same ghost again. The admin block then renders one row per record.
//
// Two cases, run in order:
//   1. seen three times → the visitor really sees the initial ghost in the chat input on
//      three page loads; the owner's transcript shows ONE row for it, marked ×3. This case
//      also proves the log pipeline works, so case 2's zero cannot be an empty-set green.
//   2. never on screen → a code bound to a microsite sends the visitor from the name picker
//      straight to /p/<slug>; the chat input is never shown, so no "shown" record may exist.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { bindCodeToPage, publishPage } from '@/fixtures/microsite-rig';
import { enterCodeSession, gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'ghost-shown@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'ghostshown',
  fullName: 'Ghost Shown Owner',
};
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const INITIAL = 'Where did you start?';
const CHAT_CODE = 'GHOSTSEEN-001';
const PAGE_CODE = 'GHOSTPAGE-001';
const SLUG = 'cover';
const COVER_APP = `import { AgentWidget } from '@standmeet/sdk';
export default function App() {
  return <main data-testid="microsite"><h1>Cover letter</h1><AgentWidget /></main>;
}`;

let admin: APIRequestContext;
let csrf = '';

interface ConvRow { id: string; visitor_name: string }
interface GhostRow { ghost_text: string }

async function ghostsOf(visitor: string): Promise<GhostRow[] | null> {
  const list = await admin.get(`${BACKEND}/api/admin/conversations`, { headers: { 'X-Csrftoken': csrf } });
  expect(list.status(), 'list conversations').toBe(200);
  const rows = ((await list.json()) as { items: ConvRow[] }).items;
  const row = rows.find((r) => r.visitor_name === visitor);
  if (row === undefined) return null;
  const detail = await admin.get(`${BACKEND}/api/admin/conversations/${row.id}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  expect(detail.status(), 'conversation detail').toBe(200);
  return ((await detail.json()) as { ghosts?: GhostRow[] }).ghosts ?? [];
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe.serial('transcript · the ghost log records what the visitor saw', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(600_000); // one microsite build
    resetInstance();
    admin = await playwright.request.newContext();
    await claim(admin, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(admin, OWNER.email, OWNER.password));
    await createCode(admin, csrf, { code: CHAT_CODE, label: 'chat', ghosts: [INITIAL] });
    const bound = await createCode(admin, csrf, { code: PAGE_CODE, label: 'page', ghosts: [INITIAL] });
    // A really built and live page, as on prod: an unbuilt page redirects differently.
    await publishPage(admin, csrf, SLUG, COVER_APP, 400_000);
    await bindCodeToPage(admin, csrf, bound.id, SLUG);
  });

  test.afterAll(async () => { await admin.dispose(); });

  test('a ghost seen on three page loads is one row, ×3', async ({ browser, adminPage, playwright }) => {
    test.setTimeout(120_000);
    // The visitor gets its own browser: adminPage IS the default page, so sharing it would
    // navigate the owner's admin away.
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    await enterCodeSession(page, CHAT_CODE, 'Seer');
    const input = page.getByTestId('chat-input-field');
    for (let load = 1; load <= 3; load++) {
      if (load > 1) await page.reload();
      await expect(input, `page load ${load}: the ghost is in the input`)
        .toHaveAttribute('data-ghost', INITIAL, { timeout: 10_000 });
    }
    // One real turn, so the conversation is unmistakably there for the owner.
    const req = await playwright.request.newContext();
    const tag = await scriptMockReplyText(req, 'noted');
    await req.dispose();
    await input.fill(`hello${tag}`);
    await input.press('Enter');
    await expect(page.getByTestId('answer-body')).toContainText('noted', { timeout: 20_000 });
    await visitor.close();

    await gotoAdminSection(adminPage, 'conversations');
    await adminPage.getByText('Seer', { exact: true }).click();
    const rows = adminPage.getByTestId('transcript-ghost-row');
    await expect(rows.first(), 'the ghost is logged').toContainText(INITIAL, { timeout: 10_000 });
    await expect(rows, 'one row per ghost, not one per page load').toHaveCount(1);
    await expect(rows.first(), 'the row says how many times it was shown').toContainText('×3');
  });

  test('a ghost never on screen is not logged as shown', async ({ browser }) => {
    const visitor = await browser.newContext();
    const page = await visitor.newPage();
    // Prod evidence: two "shown" rows per entry, stamped the second the visitor reached the page
    // — the home chat mounts and logs before the navigation lands. On localhost the navigation
    // wins that race; a real network does not. Hold the page request until the page it leaves
    // has posted "shown", or has had a real network's two seconds to do so.
    await page.route(`**/p/${SLUG}`, async (route) => {
      await page.waitForRequest('**/ghosts/shown', { timeout: 2_000 }).catch(() => undefined);
      await route.continue();
    });
    await enterCodeSession(page, PAGE_CODE, 'Redirected');
    await page.waitForURL(`**/p/${SLUG}**`, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Cover letter' }), 'the page landed')
      .toBeVisible({ timeout: 15_000 });
    await visitor.close();

    const ghosts = await ghostsOf('Redirected');
    expect(ghosts, 'guard: the visitor\'s conversation exists').not.toBeNull();
    expect(ghosts!.map((g) => g.ghost_text), 'the chat input was never shown, so nothing was "shown"')
      .toEqual([]);
  });
});
