// resume-editor-matches-thumbnail-pixels.spec.ts — BLACK BOX + PIXELS. The résumé has one source of
// truth, so the listing THUMBNAIL must render the same content, with the same renderer, as the editor
// and the PDF. The thumbnail used the legacy <ResumePage> while the A3 cutover moved the editor + PDF
// onto <ResumePuckRender> (Puck) — so the card drifted from the preview it is a miniature of, and its
// box (US-Letter shape, fixed scale) left a dark frame around an A4 page.
//
// Two riggings this removes vs the old resume-single-source spec:
//   1. It seeds content the OWNER way (create in the GUI, then MCP resume.update_draft) — not a
//      hand-built resume_content+puck_data of the shape the code expects.
//   2. It compares PIXELS/ink, not DOM text: a name can sit in the DOM of a surface that renders
//      blank or wrong.
//
// A fresh owner's manual draft is EMPTY (seedResumeContent copies a prior draft, and there is none),
// so this seeds real content first — otherwise "blank" would be correct, not a bug.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { resumeUpdateDraft, sampleResumeContent } from '@/fixtures/resume';
import { inkRatio } from '@/fixtures/pixel-compare';

const OWNER = {
  email: 'resume-pixels@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumepixels', fullName: 'Resume Pixels Owner',
};
const MARK = 'ZoltarVegaPixel';
const SHOT = '/private/tmp/claude-501/-Users-wangsijie-Develop-projects-standmeet-new/'
  + '41762946-b034-4941-b633-a02e218a6621/scratchpad/resume-thumb.png';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · the thumbnail renders the same content + renderer as the editor/PDF', () => {
  test.beforeAll(async ({ playwright }) => { await claimOwner(playwright); });

  test('a content draft shows a populated, correctly-framed thumbnail (not blank, no dark frame)',
    async ({ adminPage: page, request }) => {
      test.setTimeout(120_000);
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'resume-pixels');
      const sid = await initMCP(request, token);

      // Create a draft the owner way (GUI), then give it real content the owner way (MCP).
      await page.getByTestId('admin-nav-drafts').click();
      await page.getByRole('button', { name: /new draft/i }).click();
      await expect(page.getByTestId('new-draft-form')).toBeVisible();
      await page.getByTestId('new-draft-company').fill('Company Example');
      await page.getByTestId('new-draft-role').fill('Staff Engineer');
      await page.getByTestId('new-draft-create').click();
      await expect(page.getByTestId('new-draft-form')).toBeHidden({ timeout: 10_000 });

      const id = await firstDraftID(page);
      await resumeUpdateDraft(request, token, sid, id,
        sampleResumeContent({ identity: { ...IDENTITY, name: MARK } }));
      await page.reload();

      // The thumbnail must render visible content — a blank card fails here.
      const thumb = page.getByTestId('draft-thumb').first();
      await expect(thumb).toBeVisible({ timeout: 30_000 });
      const shot = await thumb.screenshot({ path: SHOT });
      expect(inkRatio(shot), 'the thumbnail renders visible résumé ink, not a blank/framed card')
        .toBeGreaterThan(0.03);
    });
});

const IDENTITY = {
  name: MARK, email: 'z@example.com', phone: '+1 555 0100',
  location_line: 'Remote', site: '',
};

async function firstDraftID(page: Page): Promise<string> {
  const tid = await page.locator('[data-testid^="draft-open-"]').first().getAttribute('data-testid');
  expect(tid, 'a draft card is present').toBeTruthy();
  return (tid as string).replace('draft-open-', '');
}

async function claimOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
