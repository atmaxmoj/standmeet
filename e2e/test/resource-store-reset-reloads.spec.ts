// resource-store-reset-reloads.spec.ts — after a mutation snaps the store back to idle, **a
// mounted list must refetch on its own**, rather than sitting on a skeleton forever.
//
// A real incident (the promote case in admin-wiki-crud went red under load). This timeline was
// captured from the browser, not guessed at:
//   +272ms  POST …/promote           ← still in flight
//   +287ms  navigate to /admin/output
//   +300ms  GET /corpus/output → 200 ← the store goes ready, the list renders (/output/tree also
//           fires)
//   +330ms  the POST lands → outputStore.reset() → status='idle'
//   → nobody calls ensureLoaded again (each hook's effect depends on `[ensureLoaded]`, whose
//     identity is stable, so it only ever runs once)
//   → pickOutputBodyState paints 'idle' as a skeleton → **the list spins forever**
//
// What the owner sees is "it's stuck," not "it's broken": no error, no empty state, a clean
// console. Everything works fine when the POST lands first, so this only shows itself under
// load — a lie determined purely by timing (the same family as names-that-lie).
//
// The fix lives in `useResource` (lib/state/create-resource-store): that effect depends on
// status, and re-arms whenever it becomes idle. It belongs there rather than in each individual
// use-X hook, because "forgot to handle it" produces no signal of its own, and there are 25
// callers that all need to get this right.

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'storereset@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'storereset',
  fullName: 'Store Reset Owner',
};

const WIKI_TITLE = 'Entry To Promote';
const OUTPUT_TITLE = 'Promoted While Navigating';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe.configure({ mode: 'serial' });
test.describe('resource store · a reset while mounted must reload, not strand the skeleton', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('promote then navigate immediately → the output list still resolves', promoteThenNavigate);
});

// promoteThenNavigate — **deliberately doesn't wait for the promote POST to land** before
// navigating away: that's exactly the action that triggers the race, and it's also exactly what
// an owner would do (click, then move on). Waiting for it to land would make this case pass
// whether or not the bug is fixed.
async function promoteThenNavigate({ adminPage: page }: { adminPage: Page }): Promise<void> {
  await gotoAdminSection(page, 'wiki');
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(WIKI_TITLE);
  await page.getByTestId('wiki-create-body').fill('A curated fact worth promoting.');
  await page.getByTestId('wiki-create-submit').click();
  await expect(page.getByText(WIKI_TITLE).first()).toBeVisible({ timeout: 10_000 });

  const row = page.locator('[data-testid^="wiki-row-"]', { hasText: WIKI_TITLE });
  await row.getByRole('button', { name: /promote → output/i }).click();
  await row.locator('[data-testid$="-title"]').first().fill(OUTPUT_TITLE);
  await row.getByRole('button', { name: /^promote$/i }).click();
  await gotoAdminSection(page, 'output'); // don't wait for the POST: this is exactly where the race lives

  // Asserts **the good outcome** (the list genuinely resolves), not "no error was reported": the
  // stuck state is precisely the quiet one.
  await expect(
    page.getByTestId('output-list').getByText(OUTPUT_TITLE, { exact: false }),
    'a reset() landing after the list loaded must re-arm the fetch, not strand it on the skeleton',
  ).toBeVisible({ timeout: 15_000 });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  await request.dispose();
}
