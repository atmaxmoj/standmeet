// resume-look.spec.ts —— a SCREENSHOT-only visual check of the rendered résumé (owner: "弄点假的
// 数据，就是截图，不 assert，自己观察一下出来的 resume 是不是够朴素和专业，整的对不对"). Seeds a full,
// realistic résumé and captures the composer's live (typst) preview to a PNG for human observation.
// NO assertions — this exists to be LOOKED at, not to pass/fail. Artifact lands in e2e/manual-runs/.

import { test } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'resumelook@example.com', password: 'correct-horse-battery-staple',
  handle: 'resumelook', fullName: 'Resume Look Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('résumé look (screenshot only, observe — no assert)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('render a realistic résumé and screenshot the preview', async ({ adminPage: page, playwright }) => {
    test.setTimeout(180_000);
    const id = await seedRealistic(playwright);
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${id}`).first().click();
    await page.getByTestId('composer-preview-svg')
      .waitFor({ state: 'visible', timeout: 20_000 });
    // Wait for the WASM typst render to finish (first load pulls the ~12MB compiler).
    await page.getByTestId('composer-preview-svg')
      .and(page.locator('[data-status="ready"]')).waitFor({ timeout: 120_000 });
    await page.getByTestId('composer-preview-svg')
      .screenshot({ path: 'manual-runs/resume-look.png' });
  });
});

async function seedRealistic(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const created = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Northwind', role: 'Staff Backend Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
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
  await request.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  await request.dispose();
  return id;
}
