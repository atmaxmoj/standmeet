// draft-puck-drag.spec.ts —— Q0 Group D2: editing a field in the REAL Puck editor reaches the
// canonical resume_content. Drives Puck's root fields (always shown, no canvas selection needed):
// change the Cover letter + Font size in the panel, click Save, and assert both landed in the
// persisted resume_content. docs/design/resume-composer-puck.md Group D.
//
// Why root fields, not a canvas drag: Puck's canvas runs on dnd-kit; driving its drag OR click-to-
// select with Playwright synthetic events is unreliable here (a dnd-kit render crash / selection
// that doesn't take) — the Puck+PW difficulty the owner anticipated and youteacher's own e2e avoids
// (seed data + assert artifact). So Group D1/D3 (reorder/add) are covered deterministically by the
// resume-puck round-trip units [toPuckData/fromPuckData over every section] + Group A's artifact
// sweep; THIS test covers the editor→data path through the reliable always-visible field inputs.
//
// RED-reachability: if a Puck edit didn't flow through Save into resume_content, the polled value
// stays OLD and the assertion fails.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'puck-edit@example.com', password: 'correct-horse-battery-staple',
  handle: 'puckedit', fullName: 'Puck Edit Owner',
};
const OLD = 'OLDCOVERLETTER';
const NEW = 'NEWCOVERZZ the owner rewrote this';

interface Detail { resume_content: { cover_letter?: string; font_scale?: number } }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('Puck field edit reaches resume_content (Q0 D2)', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('editing Puck fields → Save → the new values are persisted to resume_content', async ({ adminPage: page, playwright }) => {
    test.setTimeout(120_000);
    const api: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
    const id = await seed(api, csrf);

    // Precondition: the cover letter starts as OLD, font scale at the default 1.
    const before = (await getDetail(api, id)).resume_content;
    expect(before.cover_letter).toBe(OLD);

    await goto(page, `/admin/edit-resume/${id}`);
    await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });
    // The root fields are shown without selecting anything on the canvas.
    const cover = page.getByLabel('Cover letter');
    await expect(cover, 'the Cover letter field is shown').toBeVisible({ timeout: 15_000 });

    // Edit two fields in the real Puck panel: a textarea and a select.
    await cover.fill(NEW);
    await page.getByLabel('Font size').selectOption('large');

    await page.getByTestId('puck-save').click();

    // Both edits flowed through Puck's onChange → Save → the canonical resume_content.
    await expect.poll(async () => (await getDetail(api, id)).resume_content.cover_letter,
      { message: 'the edited cover letter must reach resume_content', timeout: 15_000 }).toBe(NEW);
    expect((await getDetail(api, id)).resume_content.font_scale,
      'the font-size select also reached resume_content').toBeGreaterThan(1);
    await api.dispose();
  });
});

async function getDetail(api: APIRequestContext, id: string): Promise<Detail> {
  const res = await api.get(`${BACKEND}/api/admin/drafts/${id}`);
  expect(res.status(), 'GET draft').toBe(200);
  return res.json() as Promise<Detail>;
}

async function seed(api: APIRequestContext, csrf: string): Promise<string> {
  const created = await api.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
  });
  const id = (await created.json() as { id: string }).id;
  const resume_content = {
    identity: { name: 'R', email: 'r@ex.io', phone: '', location_line: '', site: '', links: [] },
    summary: 'a summary', works: [], educations: [], skills: [], social: [], custom: [],
    cover_letter: OLD, accent: '',
  };
  await api.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf }, data: { resume_content, template: '' },
  });
  return id;
}
