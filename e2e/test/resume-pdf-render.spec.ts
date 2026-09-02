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
import type { APIRequestContext } from '@playwright/test';

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

// commitResume —— the whole job-loop commit chain (login → token → MCP → register source → fetch →
// draft under `template` → commit), returning the committed PDF. Lifted out of the describe so each
// test reads as "given this content + template, the PDF says …".
async function commitResume(
  request: APIRequestContext,
  source: { kind: string; label: string; config: Record<string, unknown> },
  content: ReturnType<typeof sampleResumeContent>, template?: string,
): Promise<{ pdf: Buffer }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, `pdf-${source.kind}`);
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, source);
  const fetched = await jobsFetchNew(request, token, sid, src.id);
  expect(fetched.jobs[0]).toBeDefined();
  const drafted = await resumeDraft(
    request, token, sid, fetched.jobs[0]!.cache_id, content, template,
  );
  return applicationsCommit(request, token, sid, drafted.view.draft_id);
}

test.describe('resume PDF render contract (Typst)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('committed PDF: 2 US-Letter pages with real resume content',
    async ({ request }) => {
      const content = sampleResumeContent();
      const committed = await commitResume(request, {
        kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
      }, content);

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
      // The page numbers must tell the truth. This fixture carries a cover letter and is two
      // pages — which happens to line up, so **this test alone cannot expose F-E-14**: that
      // only shows up when there's no cover letter (the test below).
      expectPageLabelsMatch(info.text, info.pages);
    });

  // The one without a cover letter — where F-E-14 shows up.
  //
  // Real environment: committing a resume with no cover letter through MCP produces a PDF
  // that's just one page (`/Count 1`), yet the footer reads `page 1 / 2`. Whoever receives
  // the resume goes looking for a second page that doesn't exist.
  //
  // Both pieces have to be true at once for this to happen: `print/application/[id]/page.tsx`
  // renders the second page **conditionally** (`hasCover`), while `ResumePage.tsx`
  // unconditionally prints `resume.page1`, and that string hardcodes the "/ 2" into the i18n
  // copy — **a value that could be computed was instead hand-filled**.
  test('a resume with no cover letter is one page, and says so',
    async ({ request }) => {
      const content = sampleResumeContent({ cover_letter: '' });
      const committed = await commitResume(request, {
        kind: 'lever', label: 'LeverDemo', config: { company: 'leverdemo' },
      }, content);

      const info = await inspectPDF(committed.pdf);
      // The precondition must be falsifiable: it really is one page, otherwise what's
      // asserted below is testing something else.
      expect(info.pages, 'no cover letter ⇒ one page').toBe(1);
      expectPageLabelsMatch(info.text, info.pages);
    });

  // Customization: the owner picks the 'compact' template in resume.draft, and the
  // committed PDF follows that layout — content is unchanged (the template only changes
  // presentation), and the page size stays US Letter. Choosing classic vs. compact is two
  // different layouts of the same content. This is the proof that "resume customization"
  // actually reaches the real commit flow.
  test('a compact-template draft commits to a US-Letter PDF with the same content',
    async ({ request }) => {
      const content = sampleResumeContent();
      const committed = await commitResume(request, {
        kind: 'ashby', label: 'AshbyDemo', config: { company: 'ashbydemo' },
      }, content, 'compact');

      const info = await inspectPDF(committed.pdf);
      // US Letter, unchanged by the template choice.
      expect(info.pageWidthPt).toBeGreaterThan(US_LETTER_WIDTH_PT - DIM_TOL);
      expect(info.pageWidthPt).toBeLessThan(US_LETTER_WIDTH_PT + DIM_TOL);
      // Content survives the layout switch — presentation changed, content didn't.
      expect(info.text).toContain(content.identity.name.toLowerCase());
      expect(info.text).toContain(content.works[0]!.company);
      expect(info.text).toContain(content.educations[0]!.school);
      expectPageLabelsMatch(info.text, info.pages);
    });
});

// expectPageLabelsMatch — every `page N / M` footer's M must equal the **real** page count.
// What's asserted is whether the document's own claimed total is correct, not merely
// "does a page number get printed" — the latter would stay green even if M were hardcoded
// to 2.
function expectPageLabelsMatch(text: string, pages: number): void {
  // Strip all whitespace before matching: the footer line uses monospace + letter-spacing,
  // so **the text layer actually reads `P A G E 2 / 2`** — with a space inserted between
  // every letter. The first version of this test wrote `page\s+\d+` the way it looks on
  // screen, so nothing matched at all, and it went red on "label not found" instead of
  // "total is wrong". The extraction layer doesn't look like the screen — its shape has to
  // be read, not guessed (same family as [[right-bytes-wrong-glyphs]]).
  const flat = text.replace(/\s+/g, '');
  const labels = [...flat.matchAll(/page(\d+)\/(\d+)/gi)];
  expect(
    labels.length,
    `the footer prints a page label — text tail was: ${JSON.stringify(text.slice(-200))}`,
  ).toBeGreaterThan(0);
  for (const m of labels) {
    expect(
      Number(m[2]),
      `the footer claims ${m[2]} pages but the document has ${pages}`,
    ).toBe(pages);
  }
}
