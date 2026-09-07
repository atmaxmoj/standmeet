// composer-pdf-fidelity.spec.ts —— the completeness anchor (Q0 Group A1/A2/A4,
// docs/design/resume-composer-puck.md). Every field of the canonical resume_content must reach the
// rendered Typst PDF. The old suite stayed green while the composer silently DROPPED fields (a
// "range" period lost its `end`) because it asserted form values, never the rendered artifact.
//
// The résumé editor is Puck now; resume_content stays the canonical render source (Puck data derives
// into it, tested by the resume-puck round-trip units + draft-puck-save). So this drives the ARTIFACT
// directly: seed a full resume_content (a unique sentinel in EVERY field, both period forms, CJK) via
// the real PATCH, render GET /drafts/{id}/preview.pdf, read the PDF text layer. A dropped field, a
// lost end-date, or a CJK tofu makes a sentinel absent, and the test goes RED on exactly that field.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'pdf-fidelity@example.com', password: 'correct-horse-battery-staple',
  handle: 'pdffidelity', fullName: 'PDF Fidelity Owner',
};

// One unique sentinel per field. Each is a SINGLE lowercase Latin token: the template lowercases the
// name, and PDF text extraction is unreliable about spaces (it inserts one at CJK/Latin boundaries
// and can drop them on line wraps), so single-token pure-Latin sentinels are the robust probe.
const S = {
  name: 'zqxname', email: 'zqxa@ex.io', phone: 'zqx5550100', location: 'zqxcity', site: 'zqxsite.example',
  summary: 'zqxsummary',
  skill1: 'zqxskillalpha', skill2: 'zqxskillbeta',
  org1: 'zqxorgone', role1: 'zqxroleone', loc1: 'zqxlocone', bullet1: 'zqxbulletone',
  to1: '2021-08',
  org2: 'zqxorgtwo', role2: 'zqxroletwo', loc2: 'zqxloctwo', bullet2: 'zqxbullettwo',
  school: 'zqxschool', degree: 'zqxdegree', eto: '2019-06',
  handle: 'zqxhandleexample',
  ctitle: 'zqxctitle', cvalue: 'zqxcvalue',
  cover: 'zqxcover',
};
const CJK_SUMMARY = '中文摘要句';

// fullContent —— every field carries its sentinel; one ended role (keeps end date) + one ongoing
// role (no `end` → "present").
function fullContent(): Record<string, unknown> {
  return {
    identity: {
      name: S.name, email: S.email, phone: S.phone, location_line: S.location, site: S.site, links: [],
    },
    summary: `${S.summary} ${CJK_SUMMARY}`,
    cover_letter: S.cover,
    works: [
      {
        company: S.org1, title: S.role1, location: S.loc1,
        period: { start: '2019-03', end: S.to1 }, bullets: [S.bullet1],
      },
      {
        company: S.org2, title: S.role2, location: S.loc2,
        period: { start: '2022-01', end: null }, bullets: [S.bullet2],
      },
    ],
    educations: [{ school: S.school, degree: S.degree, period: { start: '2015-09', end: S.eto } }],
    skills: [{ category: 'zqxcat', items: [S.skill1, S.skill2] }],
    social: [{ kind: 'github', label: 'github', handle: S.handle }],
    custom: [{ label: S.ctitle, value: S.cvalue, kind: '' }],
    accent: '#B5391C',
  };
}

let draftID = '';
let emptyID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · every field of resume_content reaches the rendered PDF', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    // A manual draft seeds from the newest prior draft, so create the empty-render draft BEFORE
    // draftID is filled — otherwise it inherits the full content and the empty case never runs.
    draftID = await seedDraft(api, csrf);
    emptyID = await seedDraft(api, csrf); // seeded while draftID is still empty → stays empty
    await patchContent(api, csrf, draftID, fullContent());
    await api.dispose();
  });

  test('A1/A2 · full-field sweep → all sentinels + both period forms in the PDF', async ({ adminPage }) => {
    const text = await pdfText(adminPage, draftID);
    const hay = text.toLowerCase();
    for (const [field, value] of Object.entries(S)) {
      expect(hay, `field "${field}" (${value}) reached the PDF`).toContain(value.toLowerCase());
    }
    // A2 — the ended role shows its END date; the ongoing role (no end) prints "present".
    expect(text, 'ended role keeps its end date').toContain(S.to1);
    expect(text.toLowerCase(), 'the ongoing role prints "present"').toContain('present');
    expect(text, 'CJK summary token renders (not tofu)').toContain(CJK_SUMMARY);
    expect(text.toLowerCase()).not.toContain('undefined');
    expect(text).not.toContain('[object Object]');
  });

  test('A4 · an empty draft renders without "undefined"/"null" holes or empty-section headings', async ({ adminPage }) => {
    const text = await pdfText(adminPage, emptyID);
    expect(text.toLowerCase()).not.toContain('undefined');
    expect(text.toLowerCase()).not.toContain('null');
    expect(text).not.toContain('[object Object]');
    const flat = text.replace(/\s+/g, '');
    expect(flat, 'no empty EXPERIENCE heading').not.toContain('EXPERIENCE');
    expect(flat, 'no empty EDUCATION heading').not.toContain('EDUCATION');
  });
});

async function pdfText(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
  expect(res.status(), 'preview.pdf renders').toBe(200);
  return (await inspectPDF(await res.body())).text;
}

async function patchContent(
  api: APIRequestContext, csrf: string, id: string, content: Record<string, unknown>,
): Promise<void> {
  const res = await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content: content, template: '' },
  });
  expect(res.status(), 'PATCH full content').toBe(200);
}

async function seedDraft(api: APIRequestContext, csrf: string): Promise<string> {
  const res = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  expect(res.status(), 'seed draft').toBeLessThan(300);
  return (await res.json() as { id: string }).id;
}
