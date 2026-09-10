// puck-editor-look.spec.ts —— screenshot-only observation of the new Puck résumé editor
// (/admin/edit-resume/[id]). Seeds a realistic draft, opens the Puck editor, screenshots it. NO
// assertions beyond "the editor mounted" — this is to LOOK at whether Puck renders the résumé
// sections sensibly. Artifact → e2e/manual-runs/puck-editor-look.png.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { openReader } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puchilditor@example.com', password: 'correct-horse-battery-staple',
  handle: 'puckeditor', fullName: 'Puck Editor Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Puck résumé editor (screenshot, observe)', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
  });

  test('the Puck editor mounts and renders the résumé sections', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const id = await seed(playwright);
    await openReader(page, `/admin/edit-resume/${id}`);
    await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
    // Puck renders its canvas in an iframe, so assert on the editor chrome (the section drawer), not
    // the canvas content. The 7 fixed section components proving the config loaded is enough.
    await expect(page.getByText('Experience', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'manual-runs/puck-editor-look.png', fullPage: true });
  });
});

async function seed(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const created = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Northwind', role: 'Staff Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: {
      name: 'Sijie Wang', email: 'sijie@example.com', phone: '+1 555 0142',
      location_line: 'Hamilton, ON', site: 'sijie.xyz', links: [],
    },
    summary: 'Backend engineer who builds trustworthy natural-language software.',
    works: [{
      company: 'Northwind Logistics', title: 'Senior Backend Engineer', location: 'Remote',
      period: { start: '2021-03', end: null },
      bullets: ['Owned the dispatch pipeline and its verification harness.', 'Cut p99 latency 40%.'],
    }],
    educations: [{ school: 'University of Waterloo', degree: 'B.A.Sc. Software Engineering', period: { start: '2014', end: '2018' } }],
    skills: [{ category: 'Languages', items: ['Go', 'TypeScript', 'Rust'] }],
    social: [{ kind: 'github', label: 'github', handle: 'github.com/sijie' }],
    custom: [{ label: 'Certifications', value: 'AWS SAA', kind: '' }],
    accent: '',
  };
  await request.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  await request.dispose();
  return id;
}
