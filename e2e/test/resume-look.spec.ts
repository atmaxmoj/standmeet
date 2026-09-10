// resume-look.spec.ts —— a LOOK-only render of the real résumé (owner: "弄点假的数据，就是截图，不
// assert，自己观察一下出来的 resume 是不是够朴素和专业，整的对不对"). Seeds a full, realistic résumé and
// writes the authoritative Typst PDF (GET /drafts/{id}/preview.pdf — the exact bytes a recruiter
// gets) to e2e/manual-runs/resume-look.pdf for human observation. NO assertions beyond "a PDF came
// back"; this exists to be LOOKED at.
//
// (Rewritten for the Puck cutover: the old in-browser WASM preview it screenshotted is gone; the
// authoritative artifact is the server Typst render.)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';
import { writeFileSync } from 'node:fs';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createDraft, updateDraft } from '@/fixtures/admin-mutations';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'resumelook@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumelook', fullName: 'Resume Look Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé look (render the real Typst PDF, observe — no assert)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('render a realistic résumé to PDF for observation', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seedRealistic(playwright);
    const res = await page.request.get(`${BACKEND}/api/admin/drafts/${id}/preview.pdf`);
    expect(res.status(), 'preview.pdf renders').toBe(200);
    writeFileSync('manual-runs/resume-look.pdf', await res.body());
  });
});

async function seedRealistic(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const { id } = await createDraft(request, csrf, { company: 'Northwind', role: 'Staff Backend Engineer' });
  const resume_content = {
    identity: {
      name: 'Sijie Wang', email: 'sijie@example.com', phone: '+1 555 0142',
      location_line: 'Hamilton, ON · PR', site: 'sijie.xyz', links: [],
    },
    summary: 'Backend engineer who builds trustworthy natural-language software. I care about '
      + 'systems that stay correct under real load and about tests that actually prove the thing works.',
    works: [
      {
        company: 'Northwind Logistics', title: 'Senior Backend Engineer', location: 'Remote',
        period: { start: '2021-03', end: null },
        bullets: [
          'Owned the dispatch pipeline and its verification harness across three regions.',
          'Cut p99 latency 40% on the ingestion tier under peak-season load.',
          'Mentored four engineers and ran the weekly incident review.',
        ],
      },
      {
        company: 'Acme Systems', title: 'Backend Engineer', location: 'Toronto, ON',
        period: { start: '2018-06', end: '2021-02' },
        bullets: [
          'Built the reconciliation service end to end with an exhaustive integration suite.',
          'Migrated the billing store to Postgres with zero downtime.',
        ],
      },
    ],
    educations: [
      { school: 'University of Waterloo', degree: 'B.A.Sc. Software Engineering', period: { start: '2014', end: '2018' } },
    ],
    skills: [{ category: 'Languages', items: ['Go', 'TypeScript', 'Rust', 'SQL'] }],
    social: [{ kind: 'github', label: 'github', handle: 'github.com/sijie' }],
    custom: [{ label: 'Certifications', value: 'AWS Solutions Architect (SAA)', kind: '' }],
    accent: '',
  };
  await updateDraft(request, csrf, id, { resume_content, template: '' });
  await request.dispose();
  return id;
}
