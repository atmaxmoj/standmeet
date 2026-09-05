// draft-composer-wasm-preview.spec.ts —— the composer's live preview is a real in-browser typst.ts
// (WASM) render of the draft (docs/design/composer-visual-editor.md, Phase 2), not just the server
// PDF iframe. It compiles the SAME .typ template the server uses, so what the owner sees is the
// committed layout — instantly, as they type.
//
// P2-a: the live view renders an SVG that carries the draft's own text (a distinctive name).
// P2-b: switching the template re-renders (classic vs compact produce different SVG).
//
// RED without the WASM wiring: there is no composer-preview-svg, only the PDF iframe.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-wasm@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftwasm', fullName: 'Draft WASM Owner',
};
const DISTINCT_NAME = 'Zqxwvu Testperson'; // a token that can't collide with template chrome

let draftID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · live WASM preview', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER);
    draftID = await seedDraft(playwright);
  });

  test('the live preview is a WASM SVG carrying the draft text; template switch re-renders',
    async ({ adminPage: page }) => {
      test.setTimeout(120_000); // the 28 MB compiler wasm loads + compiles on first open
      await gotoAdminSection(page, 'drafts');
      await page.getByTestId(`draft-open-${draftID}`).first().click();
      await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

      // The live (WASM) view is the default; wait for it to finish compiling.
      const svgBox = page.getByTestId('composer-preview-svg');
      await expect(svgBox).toBeVisible();
      await expect(svgBox, 'the WASM render settles').toHaveAttribute('data-status', 'ready', {
        timeout: 90_000,
      });
      await expect(svgBox.locator('svg').first(), 'it rendered an SVG page').toBeVisible();

      // P2-a: the rendered SVG carries the draft's own name (proves it compiled THIS draft, not a
      // stand-in). typst.ts emits a text layer, so the characters are in the DOM. The template
      // lowercases the name (#lower), so match case-insensitively.
      await expect(svgBox, 'the SVG carries the draft name').toContainText(/zqxwvu/i);

      // P2-b: switching template re-renders (the SVG changes).
      const before = await svgBox.innerHTML();
      await page.getByTestId('composer-template-picker').selectOption('compact');
      await expect.poll(async () => (await svgBox.innerHTML()) !== before, {
        message: 'switching template re-renders the WASM preview', timeout: 60_000,
      }).toBe(true);
    });
});

async function seedDraft(playwright: Playwright): Promise<string> {
  const request: APIRequestContext = await playwright.request.newContext();
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const res = await request.post(`${BACKEND}/api/admin/drafts`, {
    headers: { 'X-Csrftoken': csrf }, data: { company: 'ZqxCorp', role: 'Engineer' },
  });
  expect(res.status(), 'seed draft').toBeLessThan(300);
  const id = (await res.json() as { id: string }).id;
  // Give the draft a distinctive name so the render is verifiably THIS draft.
  const patch = await request.patch(`${BACKEND}/api/admin/drafts/${id}`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      template: 'classic',
      resume_content: {
        identity: { name: DISTINCT_NAME, email: '', phone: '', location_line: '', site: '', links: [] },
        summary: 'A test summary.', cover_letter: '',
        works: [], educations: [], skills: [{ category: '', items: [] }], social: [], custom: [],
      },
    },
  });
  expect(patch.status(), 'seed draft content').toBeLessThan(300);
  await request.dispose();
  return id;
}
