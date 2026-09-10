// draft-puck-section-order.spec.ts —— Q0 Group A2 (arranged order): a section arrangement must
// render in THAT order in the committed Typst PDF, end to end. This is the "moving sections actually
// moves them" guard at the artifact level: it renders one draft with works [ALPHA, BETA] and another
// with the reverse [BETA, ALPHA], and asserts the PDF text order flips. If any layer stopped honouring
// arrangement — fromPuckData regrouping, the backend, or the typst template sorting — one of the two
// positional assertions goes RED. (The editor→data half is guarded by resume-puck U3/U4;
// composer-pdf-fidelity proves every field reaches the PDF; this proves ORDER does.)
//
// Why order matters even when it "looks the same": a résumé with the same entries in a different
// order is a different document; only an order-asserting test protects a future change from silently
// reshuffling it.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createDraft, updateDraft } from '@/fixtures/admin-mutations';
import { inspectPDF } from '@/fixtures/pdf-inspect';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-order@example.com', password: 'correct-horse-battery-staple',
  handle: 'puckorder', fullName: 'Puck Order Owner',
};
const ALPHA = 'ALPHAORGZZ';
const BETA = 'BETAORGZZ';

let forwardID = '';
let reverseID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé · a section arrangement renders in that order in the PDF (Q0 A2)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    const api = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    forwardID = await seedWithOrder(api, csrf, [ALPHA, BETA]);
    reverseID = await seedWithOrder(api, csrf, [BETA, ALPHA]);
    await api.dispose();
  });

  test('works arranged [ALPHA, BETA] render ALPHA before BETA', async ({ adminPage }) => {
    const text = await pdfText(adminPage, forwardID);
    const a = text.indexOf(ALPHA);
    const b = text.indexOf(BETA);
    expect(a, 'ALPHA present').toBeGreaterThanOrEqual(0);
    expect(b, 'BETA present').toBeGreaterThanOrEqual(0);
    expect(a, 'ALPHA renders before BETA in the arranged order').toBeLessThan(b);
  });

  test('the reverse arrangement [BETA, ALPHA] flips the PDF order', async ({ adminPage }) => {
    const text = await pdfText(adminPage, reverseID);
    const a = text.indexOf(ALPHA);
    const b = text.indexOf(BETA);
    expect(b, 'BETA present').toBeGreaterThanOrEqual(0);
    expect(a, 'ALPHA present').toBeGreaterThanOrEqual(0);
    expect(b, 'reversing the arrangement renders BETA before ALPHA').toBeLessThan(a);
  });
});

async function pdfText(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
  expect(res.status(), 'preview.pdf renders').toBe(200);
  return (await inspectPDF(await res.body())).text;
}

async function seedWithOrder(api: APIRequestContext, csrf: string, order: [string, string]): Promise<string> {
  const { id } = await createDraft(api, csrf, { company: 'Acme', role: 'Engineer' });
  const work = (company: string, start: string) => ({
    company, title: 'Engineer', location: '', period: { start, end: null }, bullets: [`did ${company}`],
  });
  const resume_content = {
    identity: { name: 'R', email: 'r@ex.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'a summary',
    works: [work(order[0], '2022-01'), work(order[1], '2020-01')],
    educations: [], skills: [], social: [], custom: [], accent: '',
  };
  await updateDraft(api, csrf, id, { resume_content, template: '' });
  return id;
}
