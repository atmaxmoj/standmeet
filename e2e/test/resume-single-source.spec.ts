// resume-single-source.spec.ts — #1: the résumé has ONE source of truth (resume_content). The
// editor canvas, the listing thumbnail, and the committed-render PDF must all show the SAME content.
//
// The bug this guards: a draft could carry a stored puck_data that had drifted from resume_content
// (agent-created / a stale save), so the composer opened BLANK while the listing thumbnail and the
// PDF rendered the populated resume_content (owner: "多个 source of truth，编辑器是唯一真相"). The
// editor now ALWAYS derives its Puck document from resume_content, so an empty/stale puck_data can no
// longer win — and Save can no longer overwrite a real resume_content with an empty editor.
//
// RED-reachability: seed the exact divergence (populated resume_content + an EMPTY stored puck_data).
// On the old code the editor opens blank (T1 fails) and a Save wipes resume_content (T3 fails).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createDraft, updateDraft } from '@/fixtures/admin-mutations';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'resume-sot@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumesot', fullName: 'Resume SoT Owner',
};

// Unique sentinels — a match can only come from the seeded resume_content, never chrome/other data.
// The résumé DISPLAYS the name lowercase by design, so display surfaces are matched case-insensitively
// (NAME_SHOWN); the stored-value check uses the original case (NAME).
const NAME = 'ZoltarVega';
const NAME_SHOWN = new RegExp(NAME, 'i');
const SUMMARY = 'quokka-summary-9137 backend engineer';
const SKILL = 'Rustacean';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · one source of truth (editor == thumbnail == PDF)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('an empty stored puck_data does not blank the editor; all three surfaces show resume_content',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      const id = await seedDivergent(api, csrf);

      // Reach the composer by clicking (drafts nav → open composer), never a goto teleport.
      await page.getByTestId('admin-nav-drafts').click();
      await expect(page.getByTestId(`draft-open-${id}`)).toBeVisible({ timeout: 30_000 });

      // Surface 1 — the listing thumbnail (renders resume_content) shows the real content.
      await expect(page.getByTestId('draft-thumb').first(), 'thumbnail shows the seeded name')
        .toContainText(NAME_SHOWN, { timeout: 30_000 });

      await page.getByTestId(`draft-open-${id}`).click();
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

      // Surface 2 — the editor opens with resume_content, NOT the empty stored puck_data.
      const canvas = page.frameLocator('iframe').first();
      await expect(canvas.locator('[data-sec="header"]'), 'editor header carries the seeded name')
        .toContainText(NAME_SHOWN, { timeout: 30_000 });
      await expect(canvas.locator('[data-sec="summary"]'), 'editor summary carries the seeded summary')
        .toContainText('quokka-summary-9137');

      // Surface 3 — the committed-render PDF carries the SAME content.
      const pdfRes = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
      expect(pdfRes.status(), 'preview.pdf renders').toBe(200);
      const pdf = (await inspectPDF(await pdfRes.body())).text.normalize('NFKC');
      expect(pdf, 'PDF carries the seeded name').toMatch(NAME_SHOWN);
      expect(pdf, 'PDF carries the seeded summary').toContain('quokka-summary-9137');

      // Data-loss guard — saving the freshly-opened (unedited) draft must NOT wipe resume_content.
      await page.getByTestId('puck-save').click();
      await expect.poll(async () => {
        const detail = await (await api.get(`${BACKEND}/api/admin/drafts/${id}`))
          .json() as { resume_content?: { identity?: { name?: string } } };
        return detail.resume_content?.identity?.name;
      }, {
        message: 'Save preserves resume_content (never overwrites it with an empty editor)',
        timeout: 20_000,
      }).toBe(NAME);

      await api.dispose();
    });
});

// seedDivergent — a draft carrying real resume_content AND an empty stored puck_data: the exact
// drift the single-source fix defends against.
async function seedDivergent(api: APIRequestContext, csrf: string): Promise<string> {
  const { id } = await createDraft(api, csrf, { company: 'Northwind', role: 'Staff Engineer' });
  const resume_content = {
    identity: {
      name: NAME, email: 'z@example.com', phone: '+1 555 0100',
      location_line: 'Remote', site: '', links: [],
    },
    summary: SUMMARY,
    works: [], educations: [],
    skills: [{ category: 'Languages', items: [SKILL] }],
    social: [], custom: [], accent: '',
  };
  // Populated content + EMPTY puck_data = the divergence. The fix ignores the empty puck_data and
  // derives the editor from resume_content, so the editor is not blanked.
  await updateDraft(api, csrf, id, { resume_content, template: '', puck_data: { content: [], root: { props: {} } } });
  return id;
}
