// composer-pdf-fidelity.spec.ts —— the completeness anchor (composer-test-strategy.md, A1/A2/A4).
// Every field the owner types in the composer must reach the rendered PDF. The suite stayed green
// while the composer silently DROPPED fields (the "range" period lost `end`) because assertions
// checked testids and form values, never the rendered artifact. This drives the REAL composer form,
// fills EVERY field with a unique sentinel, saves, and reads the draft's rendered Typst PDF
// (GET /drafts/{id}/preview.pdf → inspectPDF text layer): a dropped field, a lost end-date, or a CJK
// tofu makes a sentinel absent, and the test goes RED on exactly that field.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'pdf-fidelity@example.com', password: 'correct-horse-battery-staple',
  handle: 'pdffidelity', fullName: 'PDF Fidelity Owner',
};

// One unique sentinel per field. Each is a SINGLE lowercase Latin token: the template lowercases the
// name, and PDF text extraction is unreliable about spaces (it inserts one at CJK/Latin boundaries
// and can drop them on line wraps), so single-token pure-Latin sentinels are the robust completeness
// probe. CJK rendering is covered separately below (a pure-CJK token) and in composer-cjk-renders.
const S = {
  name: 'zqxname', email: 'zqxa@ex.io', phone: 'zqx5550100', location: 'zqxcity', site: 'zqxsite.example',
  summary: 'zqxsummary',
  skill1: 'zqxskillalpha', skill2: 'zqxskillbeta',
  org1: 'zqxorgone', role1: 'zqxroleone', loc1: 'zqxlocone', bullet1: 'zqxbulletone',
  from1: '2019-03', to1: '2021-08',           // ENDED role → keeps its end date, never "present"
  org2: 'zqxorgtwo', role2: 'zqxroletwo', loc2: 'zqxloctwo', bullet2: 'zqxbullettwo',
  from2: '2022-01',                            // ongoing role (no `to`) → "present"
  school: 'zqxschool', degree: 'zqxdegree', efrom: '2015-09', eto: '2019-06',
  handle: 'zqxhandleexample',
  ctitle: 'zqxctitle', cvalue: 'zqxcvalue',
  cover: 'zqxcover',
};
// A pure-CJK token, appended to the summary, asserted on its own — proves CJK survives a mixed-script
// draft in the committed PDF here too (not just in composer-cjk-renders).
const CJK_SUMMARY = '中文摘要句';

let draftID = '';
// A manual draft seeds from the newest prior draft, so the empty-render draft must be created BEFORE
// A1 fills draftID — otherwise it inherits A1's content and the empty case is never exercised.
let emptyID = '';

async function pdfText(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
  expect(res.status(), 'preview.pdf renders').toBe(200);
  return (await inspectPDF(await res.body())).text;
}

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('composer · every typed field reaches the rendered PDF', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
    emptyID = await seedDraft(playwright); // seeded while draftID is still empty → stays empty
  });

  test('A1/A2 · full-field sweep → all sentinels + both period forms in the PDF', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    // header — identity + contact
    await page.getByTestId('composer-panel-header').click();
    await page.getByTestId('composer-name').fill(S.name);
    await page.getByTestId('composer-email').fill(S.email);
    await page.getByTestId('composer-phone').fill(S.phone);
    await page.getByTestId('composer-location').fill(S.location);
    await page.getByTestId('composer-site').fill(S.site);

    await page.getByTestId('composer-panel-summary').click();
    await page.getByTestId('composer-summary').fill(`${S.summary} ${CJK_SUMMARY}`);

    await page.getByTestId('composer-panel-skills').click();
    await page.getByTestId('composer-skills').fill(`${S.skill1}, ${S.skill2}`);

    // experience — two rows: one ended, one ongoing
    await page.getByTestId('composer-panel-experience').click();
    await page.getByTestId('composer-exp-add').click();
    await fillExp(page, 'e-new-0', S.org1, S.role1, S.from1, S.to1, S.loc1, S.bullet1);
    await page.getByTestId('composer-exp-add').click();
    await fillExp(page, 'e-new-1', S.org2, S.role2, S.from2, '', S.loc2, S.bullet2);

    await page.getByTestId('composer-panel-education').click();
    await page.getByTestId('composer-edu-add').click();
    await page.getByTestId('composer-edu-school-ed-new-0').fill(S.school);
    await page.getByTestId('composer-edu-degree-ed-new-0').fill(S.degree);
    await page.getByTestId('composer-edu-from-ed-new-0').fill(S.efrom);
    await page.getByTestId('composer-edu-to-ed-new-0').fill(S.eto);

    await page.getByTestId('composer-panel-social').click();
    await page.getByTestId('composer-social-add').click();
    await page.getByTestId('composer-social-handle-s-new-0').fill(S.handle);

    await page.getByTestId('composer-panel-custom').click();
    await page.getByTestId('composer-custom-add').click();
    await page.getByTestId('composer-custom-title-c-new-0').fill(S.ctitle);
    await page.getByTestId('composer-custom-value-c-new-0').fill(S.cvalue);

    await page.getByTestId('composer-panel-cover').click();
    await page.getByTestId('composer-cover').fill(S.cover);

    await expect(page.getByTestId('composer-saved')).toHaveText('saved', { timeout: 20_000 });

    const text = await pdfText(page, draftID);

    // Every field is present — a dropped field fails on exactly its sentinel. Case-insensitive: the
    // template lowercases the name and uppercases section-head labels (the custom title), so a
    // case-sensitive match would flag a rendered-but-recased field as missing.
    const hay = text.toLowerCase();
    for (const [field, value] of Object.entries(S)) {
      expect(hay, `field "${field}" (${value}) reached the PDF`).toContain(value.toLowerCase());
    }
    // A2 — the ended role shows its END date (S.to1 is asserted in the loop above; the single-field
    // period bug dropped it, printing "present" instead). The ongoing role (no `to`) shows "present".
    // Assert the dates individually, not the exact en-dash concatenation (PDF text extraction is not
    // reliable about the dash glyph/spacing).
    expect(text, 'ended role keeps its end date').toContain(S.to1);
    expect(text.toLowerCase(), 'the ongoing role prints "present"').toContain('present');
    // CJK survives a mixed-script draft in the committed PDF (not tofu).
    expect(text, 'CJK summary token renders').toContain(CJK_SUMMARY);
    // No raw JS holes leaked into the document.
    expect(text.toLowerCase()).not.toContain('undefined');
    expect(text).not.toContain('[object Object]');
  });

  test('A4 · an untouched draft renders without "undefined"/"null" holes or empty-section headings', async ({ adminPage: page }) => {
    const text = await pdfText(page, emptyID);
    expect(text.toLowerCase()).not.toContain('undefined');
    expect(text.toLowerCase()).not.toContain('null');
    expect(text).not.toContain('[object Object]');
    // Empty sections print no heading (parity with ResumePage). sechead uses letter-spacing, so the
    // text layer reads "E X P E R I E N C E" — strip whitespace before matching.
    const flat = text.replace(/\s+/g, '');
    expect(flat, 'no empty EXPERIENCE heading').not.toContain('EXPERIENCE');
    expect(flat, 'no empty EDUCATION heading').not.toContain('EDUCATION');
  });
});

async function fillExp(
  page: Page, id: string, org: string, role: string, from: string, to: string, loc: string, bullet: string,
): Promise<void> {
  await page.getByTestId(`composer-exp-org-${id}`).fill(org);
  await page.getByTestId(`composer-exp-role-${id}`).fill(role);
  await page.getByTestId(`composer-exp-from-${id}`).fill(from);
  if (to !== '') await page.getByTestId(`composer-exp-to-${id}`).fill(to);
  await page.getByTestId(`composer-exp-loc-${id}`).fill(loc);
  await page.getByTestId(`composer-exp-bullets-${id}`).fill(bullet);
}

async function seedDraft(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  expect(res.status(), 'seed draft').toBeLessThan(300);
  const id = (await res.json() as { id: string }).id;
  await request.dispose();
  return id;
}
