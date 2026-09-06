// composer-cjk-renders.spec.ts —— the committed résumé PDF must render CJK as real glyphs, not tofu.
// I (owner-reported, on sijie): Chinese text in a draft came out as tofu boxes ("cjk 也失败了").
// typst renders with its bundled Latin fonts only (Newsreader / JetBrains Mono, no CJK), and the
// server passes no CJK font — so any Chinese/Japanese/Korean character has no glyph and prints .notdef.
//
// This is an ARTIFACT test, not a plumbing test (docs/design/composer-v2-backlog.md, matrix T2):
// commit a résumé whose name and a bullet are CJK, then read the PDF's TEXT LAYER. A font that
// embeds the glyphs yields a text layer containing the characters; tofu does not.
//
// RED until a CJK font is on the server's typst --font-path AND in the template's fallback list.
// This guard fails ON the bug (the CJK string is absent from the PDF text), per [[guard-must-fail-on-the-bug]].

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { jobsFetchNew, jobsRegisterSource } from '@/fixtures/jobs';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const OWNER = {
  email: 'cjk@example.com', password: 'correct-horse-battery-staple',
  handle: 'cjkowner', fullName: 'CJK Owner',
};

// Distinctive CJK strings that won't line-wrap mid-phrase.
const CJK_NAME = '王思杰';
const CJK_BULLET = '中文字体渲染测试通过';

test.describe('resume PDF renders CJK glyphs (not tofu)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('CJK name + bullet survive into the committed PDF text layer', async ({ request }) => {
    const content = sampleResumeContent({
      identity: {
        ...sampleResumeContent().identity,
        name: CJK_NAME,
      },
      works: [{
        title: 'staff engineer', company: 'Acme', location: 'Remote',
        period: { start: '2023-01', end: '' },
        bullets: [CJK_BULLET, 'a second bullet in latin'],
      }],
    });

    const committed = await commitResume(request, content);
    const info = await inspectPDF(committed.pdf);

    expect(info.text.length, 'the PDF has a real text layer').toBeGreaterThan(200);
    // The template lowercases the name; CJK has no case, so it is unchanged.
    expect(info.text, 'CJK name is a real glyph in the PDF, not tofu').toContain(CJK_NAME);
    expect(info.text, 'CJK bullet is a real glyph in the PDF, not tofu').toContain(CJK_BULLET);
  });
});

async function commitResume(
  request: APIRequestContext, content: ReturnType<typeof sampleResumeContent>,
): Promise<{ pdf: Buffer }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'cjk-pdf');
  const sid = await initMCP(request, token);
  const src = await jobsRegisterSource(request, token, sid, {
    kind: 'greenhouse', label: 'Anthropic', config: { company: 'anthropic' },
  });
  const fetched = await jobsFetchNew(request, token, sid, src.id);
  expect(fetched.jobs[0]).toBeDefined();
  const drafted = await resumeDraft(request, token, sid, fetched.jobs[0]!.cache_id, content);
  return applicationsCommit(request, token, sid, drafted.view.draft_id);
}
