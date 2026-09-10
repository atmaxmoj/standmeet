// resume-editor-matches-thumbnail-pixels.spec.ts — BLACK BOX + REAL PIXELS. The résumé has one source
// of truth, so the listing THUMBNAIL must render the same picture, with the same renderer, as the
// editor canvas (both are <ResumePuckRender> in the same chromium — NOT a cross-pipeline compare, so
// a pixel diff is fair, not flaky). The thumbnail once used the legacy <ResumePage> and a US-Letter
// box around an A4 page, so it drifted from the preview it is a miniature of.
//
// Why this replaces the old inkRatio-only check (owner, twice): inkRatio only answers "is anything
// drawn at all". It cannot see that the thumbnail renders a DIFFERENT picture than the editor — a
// missing QR frame, a dark border, a wrong layout. So this screenshots the SAME element (.sm-resume-
// paper) on both surfaces, normalizes them to one small canvas, and asserts the pixel diff is small.
// And it asserts the QR treatment is identical (a draft has no issued code, so both show the same
// placeholder frame — never a real QR on one side and nothing on the other).
//
// A fresh owner's manual draft is EMPTY, so this seeds real content first (MCP, the owner way) —
// otherwise "blank" would be correct, not a bug.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, FrameLocator, Locator, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { resumeUpdateDraft, sampleResumeContent } from '@/fixtures/resume';
import { diffRatio, inkRatio } from '@/fixtures/pixel-compare';

const OWNER = {
  email: 'resume-pixels@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumepixels', fullName: 'Resume Pixels Owner',
};
const MARK = 'ZoltarVegaPixel';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · the thumbnail renders the same picture + QR treatment as the editor', () => {
  test.beforeAll(async ({ playwright }) => { await claimOwner(playwright); });

  test('editor canvas and listing thumbnail are the same résumé, pixel-for-pixel, QR included',
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

      // Surface A — the listing thumbnail. Screenshot the paper itself (not the card), and grab its
      // QR treatment while we are on the listing.
      const thumb = page.getByTestId('draft-thumb').first();
      await expect(thumb, 'a thumbnail is present').toBeVisible({ timeout: 30_000 });
      const thumbPaper = thumb.locator('.sm-resume-paper');
      await expect(thumbPaper).toBeVisible();
      const thumbShot = await thumbPaper.screenshot();
      const thumbQR = await qrTreatment(thumb);

      // Surface B — the editor canvas (same renderer, full size, inside the Puck iframe).
      await page.getByTestId(`draft-open-${id}`).click();
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
      const canvas: FrameLocator = page.frameLocator('iframe').first();
      const editorPaper = canvas.locator('.sm-resume-paper');
      await expect(editorPaper, 'editor renders the résumé paper').toBeVisible({ timeout: 30_000 });
      await expect(canvas.locator('[data-sec="header"]'), 'editor carries the seeded name')
        .toContainText(new RegExp(MARK, 'i'), { timeout: 30_000 });
      const editorShot = await editorPaper.screenshot();
      const editorQR = await qrTreatment(canvas.locator('[data-sec="header"]'));

      // Both papers must be genuinely drawn (a blank 0-ink capture would make the diff meaningless).
      expect(inkRatio(editorShot), 'editor paper has ink').toBeGreaterThan(0.02);
      expect(inkRatio(thumbShot), 'thumbnail paper has ink (not a blank/framed card)')
        .toBeGreaterThan(0.02);

      // The real pixel comparison: normalized to one canvas, the thumbnail is a faithful miniature of
      // the editor. A drifted renderer / dark frame / missing section pushes this well past the bound.
      const diff = diffRatio(editorShot, thumbShot);
      expect(diff, `editor vs thumbnail pixel diff ${diff.toFixed(3)} is small (same picture)`)
        .toBeLessThan(0.18);

      // QR consistency: a draft has no issued code, so BOTH surfaces must show the same placeholder
      // frame. Never a scannable QR on one and a blank (or nothing) on the other.
      expect(editorQR, 'editor QR is the placeholder frame').toBe('placeholder');
      expect(thumbQR, 'thumbnail QR treatment matches the editor').toBe(editorQR);
    });
});

const IDENTITY = {
  name: MARK, email: 'z@example.com', phone: '+1 555 0100',
  location_line: 'Remote', site: '',
};

// qrTreatment — what the header's QR cell is showing: 'placeholder' (the "QR" frame a code-less draft
// draws), 'real' (a scannable <svg>/<canvas> QR), or 'none' (no QR cell at all). Lets the test assert
// the two surfaces AGREE without caring which of placeholder/none the design lands on — only that
// they match and that neither smuggles in a real QR for an unissued draft.
async function qrTreatment(scope: Locator | FrameLocator): Promise<'placeholder' | 'real' | 'none'> {
  const cell = scope.locator('[data-sec="qr"]');
  if (await cell.count() === 0) return 'none';
  const text = ((await cell.first().textContent()) ?? '').trim();
  if (text === 'QR') return 'placeholder';
  return 'real';
}

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
