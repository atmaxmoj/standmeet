// resume-pdf-render.spec.ts —— the contract a freshly-rendered
// applications.commit PDF must satisfy. This is the regression net for
// the gotenberg + print-route + ResumePage chain.
//
// What we guard:
//   1. The PDF has a real text layer — proves gotenberg rendered the
//      React component, not Chromium's "ERR_SSL_PROTOCOL_ERROR" page
//      (which had real text too but the wrong text). We assert specific
//      ResumeContent fields appear.
//   2. Page count is exactly 2 — cover letter present in the sample, so
//      both ResumePage instances must paginate without bleeding past
//      page boundaries.
//   3. Page dimensions are exactly US Letter (612 × 792 pt). A page that
//      came back at 459 × 594 (== 75% scale = the bug we just fixed)
//      would silently break the "612 px page fills paper" invariant.
//
// All three would have prevented yesterday's bugs:
//   - SSL-error PDF (real text layer, but no resume content + 1 page +
//     wrong dims when Chrome upgraded `app` to https) — fails on #1+#3.
//   - 612 CSS px page on 816 CSS px viewport (right-side blank) — fails
//     on #3 because the page renders at 459×594 pt after scale fix.

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import {
  applicationsCommit, resumeDraft, sampleResumeContent,
} from '@/fixtures/resume';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

// US Letter at 72 dpi.
const US_LETTER_WIDTH_PT = 612;
const US_LETTER_HEIGHT_PT = 792;
// 1pt rounding leeway covers gotenberg's mediaBox precision.
const DIM_TOL = 1;

test.describe('resume PDF render contract (gotenberg + ResumePage)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('committed PDF: 2 US-Letter pages with real resume content',
    async ({ request }) => {
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const token = await createAPIToken(request, csrf, 'pdf-render-contract');
      const sid = await initMCP(request, token);
      const source = await jobsRegisterSource(request, token, sid, {
        kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
      });
      const fetched = await jobsFetchNew(request, token, sid, source.id);
      const first = fetched.jobs[0];
      expect(first).toBeDefined();
      const content = sampleResumeContent();
      const drafted = await resumeDraft(
        request, token, sid, first!.cache_id, content,
      );
      const committed = await applicationsCommit(
        request, token, sid, drafted.view.draft_id,
      );

      const info = await inspectPDF(committed.pdf);

      // (3) Dims — guards the "right-side blank" bug.
      expect(info.pageWidthPt).toBeGreaterThan(US_LETTER_WIDTH_PT - DIM_TOL);
      expect(info.pageWidthPt).toBeLessThan(US_LETTER_WIDTH_PT + DIM_TOL);
      expect(info.pageHeightPt).toBeGreaterThan(US_LETTER_HEIGHT_PT - DIM_TOL);
      expect(info.pageHeightPt).toBeLessThan(US_LETTER_HEIGHT_PT + DIM_TOL);

      // (2) Page count — sample has a cover letter, must paginate to 2.
      expect(info.pages).toBe(2);

      // (1) Text layer — proves the React ResumePage rendered, not the
      // Chromium SSL error page or a 404.
      expect(info.text.length).toBeGreaterThan(500);
      // Page 1 content
      expect(info.text).toContain(content.identity.name.toLowerCase());
      expect(info.text).toContain(content.identity.email);
      expect(info.text).toContain(content.works[0]!.company);
      // Bullets are wrapped; assert a short prefix that won't line-break.
      expect(info.text).toContain(content.works[0]!.bullets[0]!.slice(0, 40));
      expect(info.text).toContain(content.educations[0]!.school);
      expect(info.text).toContain(content.skills[0]!.items[0]!);
      // Page 2 content (cover letter)
      expect(info.text).toContain(content.works[0]!.company); // "To Acme."
      // First sentence of the cover letter prose (won't span a line wrap).
      expect(info.text).toContain('The role caught my eye');
    });
});
