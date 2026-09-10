// draft-puck-dirty.spec.ts —— unsaved-changes tracking + discard-on-leave for the Puck composer.
// Dirty is decided by a RECURSIVE VALUE COMPARE of the current Puck doc against the last-saved one
// (jsonEqual), NOT by whether an edit fired — so editing and then undoing back to the saved value
// reads as clean again. Leaving with unsaved edits asks before discarding.
//
// Drives the real editor via a root field (reliable; canvas drag is flaky — see draft-puck-field-edit).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { openReader } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-dirty@example.com', password: 'correct-horse-battery-staple',
  handle: 'puckdirty', fullName: 'Puck Dirty Owner',
};
const ORIGINAL = 'ORIGINALZZ cover letter';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Puck composer · unsaved-changes tracking + discard on leave', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('edit → dirty + discard prompt; undo back to the saved value → clean; leaves', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const id = await seed(api, csrf);

    await openReader(page, `/admin/edit-resume/${id}`);
    await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
    const save = page.getByTestId('puck-save');
    const cover = page.getByLabel('Cover letter');
    await expect(cover).toBeVisible({ timeout: 15_000 });

    // Clean on load — nothing edited yet.
    await expect(save, 'a freshly-opened draft is not dirty').toHaveAttribute('data-dirty', 'false');

    // Edit → dirty.
    await cover.fill(`${ORIGINAL} EDITED`);
    await expect(save, 'an edit marks the composer dirty').toHaveAttribute('data-dirty', 'true');

    // Leaving now asks first — the discard modal appears, and Keep editing dismisses it (stays put).
    await page.getByTestId('composer-back').click();
    await expect(page.getByTestId('discard-modal'), 'leaving dirty asks before discarding').toBeVisible();
    await page.getByTestId('discard-keep').click();
    await expect(page.getByTestId('discard-modal')).toHaveCount(0);
    await expect(page.getByTestId('puck-composer'), 'Keep editing stays in the composer').toBeVisible();

    // The KEY property: undo the edit back to the saved value → clean again (value compare, not an
    // edit-happened flag). A trace-based dirty flag would stay dirty here.
    await cover.fill(ORIGINAL);
    await expect(save, 'undoing back to the saved value clears dirty').toHaveAttribute('data-dirty', 'false');

    // Now leaving is immediate — no discard prompt — and lands on /admin/drafts.
    await page.getByTestId('composer-back').click();
    await expect(page.getByTestId('discard-modal')).toHaveCount(0);
    await page.waitForURL(/\/admin\/drafts$/, { timeout: 10_000 });
    await api.dispose();
  });
});

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: { name: 'R', email: 'r@ex.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'a summary', works: [], educations: [], skills: [], social: [], custom: [],
    cover_letter: ORIGINAL, accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
