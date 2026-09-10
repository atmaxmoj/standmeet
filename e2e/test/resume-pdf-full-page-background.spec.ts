// resume-pdf-full-page-background.spec.ts —— #9: the résumé paper ground fills the WHOLE A4 page, on
// every page. The bug (owner: "漏了半拉白屁股"): a short page — a one-line cover letter alone on page
// 2 — left everything below the text white, because the paper div's background only covers its own
// content box. The fix pins the page ground (html/body) to cream so Chromium paints every printed
// page's full area, not just the text.
//
// A text-only pdf-parse can't see this (it reads the text layer, not the rendered fill), so this is
// the first spec to RASTERIZE the committed PDF (pdf-raster.ts) and sample pixels. It commits a
// résumé with a deliberately SHORT cover letter, so page 2 is almost entirely empty — the exact
// place the white used to show — then asserts the lower area of page 2 is the paper cream, not white.
//
// Falsifiable: revert the html/body cream fix and the sampled lower-page pixels read white
// (#FFFFFF), not cream (#F3EFE6) — verified RED.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { rasterizePDFPage, near, CREAM, WHITE } from '@/fixtures/pdf-raster';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

// A one-liner: break-before-page still forces a 2nd page, and page 2 is now almost all empty — the
// whole lower page is the background under test.
const SHORT_COVER = 'Dear team, I would be glad to contribute. Best, Alice.';

async function commitResume(request: APIRequestContext): Promise<{ pdf: Buffer }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'pdf-bg');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
  });
  const fetched = await jobsFetchNew(request, token, sid, src.id);
  expect(fetched.jobs[0]).toBeDefined();
  const content = sampleResumeContent({ cover_letter: SHORT_COVER });
  const drafted = await resumeDraft(request, token, sid, fetched.jobs[0]!.cache_id, content);
  return applicationsCommit(request, token, sid, drafted.view.draft_id);
}

test.describe('résumé PDF: the paper ground fills every page, not just the text box', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('page 2 (a short cover letter) is cream to the bottom, not white', async ({ request }) => {
    const { pdf } = await commitResume(request);
    const page2 = await rasterizePDFPage(pdf, 2);

    // Sample the LOWER area of page 2 — below any cover-letter text — across the width. This is the
    // region that used to render white. Stay a little in from the very edges (>1% margin) to avoid
    // a stray edge pixel; the whole interior of the lower page must be the paper cream.
    const ys = [0.7, 0.82, 0.94].map((f) => Math.floor(page2.height * f));
    const xs = [0.25, 0.5, 0.75].map((f) => Math.floor(page2.width * f));
    for (const y of ys) {
      for (const x of xs) {
        const px = page2.rgba(x, y);
        expect(
          near(px, CREAM),
          `lower page-2 pixel (${x},${y}) must be paper cream, was rgb(${px.r},${px.g},${px.b})`,
        ).toBe(true);
        // And explicitly NOT the old white ground — a redundant guard that makes the failure read
        // "still white" rather than only "not cream".
        expect(near(px, WHITE), `pixel (${x},${y}) must not be the old white ground`).toBe(false);
      }
    }
  });
});
