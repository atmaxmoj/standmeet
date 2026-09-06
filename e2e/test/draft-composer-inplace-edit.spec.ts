// draft-composer-inplace-edit.spec.ts —— on-canvas editing (docs/design/composer-visual-editor.md,
// Phase 3). The live WASM preview isn't read-only: each editable field carries a ✎ hotspot at its
// rendered position (from the template's edit-anchor → typst query via runWithWorld); clicking it
// opens an inline editor on the document, and committing rewrites the draft → the preview recompiles
// + autosave persists it. Editing on the résumé itself, not only in the form.
//
// RED without Phase 3: there's no composer-edit-hotspot-summary; the preview is read-only.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-inplace@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftinplace', fullName: 'Draft Inplace Owner',
};
const ORIG = 'Origsummary original text.';
const EDITED = 'Editedsummary new text.';

let draftID = '';

async function seedDraft(request: APIRequestContext, csrf: string, summary: string): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'ZqxCorp', role: 'Engineer' },
  });
  const id = (await res.json() as { id: string }).id;
  await request.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      template: 'classic',
      resume_content: {
        identity: { name: 'Zqx Test', email: '', phone: '', location_line: '', site: '', links: [] },
        summary, cover_letter: '',
        works: [], educations: [], skills: [{ category: '', items: [] }], social: [], custom: [],
      },
    },
  });
  return id;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · edit on the canvas', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    draftID = await seedDraft(request, csrf, ORIG);
    await request.dispose();
  });

  test('click the summary on the canvas → edit inline → preview updates + persists', async ({
    adminPage: page,
  }) => {
    test.setTimeout(120_000);
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    const svgBox = page.getByTestId('composer-preview-svg');
    await expect(svgBox).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
    await expect(svgBox, 'the original summary is rendered').toContainText('Origsummary');

    // The on-canvas ✎ hotspot for the summary is placed from the template anchor (typst query).
    const hotspot = page.getByTestId('composer-edit-hotspot-summary');
    await expect(hotspot, 'a summary edit hotspot sits on the canvas').toBeVisible({ timeout: 15_000 });
    await hotspot.click();

    // The inline editor opens prefilled with the current summary; edit it, then blur to commit.
    const editor = page.getByTestId('composer-edit-input-summary');
    await expect(editor).toBeVisible();
    await expect(editor, 'prefilled with the field value').toHaveValue(ORIG);
    await editor.fill(EDITED);
    await svgBox.click({ position: { x: 5, y: 5 } }); // blur → commit

    // The preview recompiles with the edit (WYSIWYG), and the old text is gone.
    await expect(svgBox, 'the edit shows on the canvas').toContainText('Editedsummary', {
      timeout: 30_000,
    });
    await expect(svgBox).not.toContainText('Origsummary');

    // It persisted: autosave saved it, and a reopen shows the new summary in the form too.
    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 15_000 });
    await page.getByTestId('composer-back').click();
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await page.getByTestId('composer-panel-summary').click();
    await expect(page.getByTestId('composer-summary'), 'the canvas edit persisted').toHaveValue(EDITED);
  });
});
