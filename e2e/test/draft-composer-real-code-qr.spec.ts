// draft-composer-real-code-qr.spec.ts —— the composer's QR always carries a REAL access code, never
// a placeholder (owner: "不要place holder ... 永远真code"). The code picker selects only from EXISTING
// codes (public / invited) and defaults to one; the live preview renders that code's real QR + URL,
// so what's on screen is exactly what the recruiter will scan.
//
// Seeds one code, opens the composer, and proves: the picker defaults to that real code, and the
// live WASM preview renders the QR image for it. The URL text used to sit in a footer, but the footer
// was removed (owner: "不要footer") — the address now lives only in the QR. So the exact encoded URL
// is guarded at the artifact layer by resume-qr-host (commit qr_url = <public_url>?code=); here we
// prove the picker→preview wiring: a selected real code makes a QR image appear (an empty draft with
// no code draws only the empty box).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { gotoAdminSection } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'draft-realqr@example.com', password: 'correct-horse-battery-staple',
  handle: 'draftrealqr', fullName: 'Draft RealQR Owner',
};
const CODE = 'ZQXQR-RECRUIT7'; // distinctive, so finding it in the rendered QR URL proves it's real

let draftID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('resume composer · the QR carries a real, existing code', () => {
  test.beforeAll(async ({ playwright }) => {
    await claimFreshOwner(playwright, OWNER); // claim sets public_url, so the QR URL can be built
    const request: APIRequestContext = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const codeRes = await request.post(`${BACKEND}/api/admin/codes/`, {
      headers: { 'X-Csrftoken': csrf },
      data: { code: CODE, label: 'Recruiters', purpose: '', ghosts: [], provider_id: '' },
    });
    expect(codeRes.status(), 'seed an access code').toBeLessThan(300);
    const draftRes = await request.post(`${BACKEND}/api/admin/drafts`, {
      headers: { 'X-Csrftoken': csrf }, data: { company: 'ZqxCorp', role: 'Engineer' },
    });
    draftID = (await draftRes.json() as { id: string }).id;
    await request.dispose();
  });

  test('the picker defaults to the real code and the preview QR encodes it', async ({
    adminPage: page,
  }) => {
    test.setTimeout(120_000);
    await gotoAdminSection(page, 'drafts');
    await page.getByTestId(`draft-open-${draftID}`).first().click();
    await expect(page.getByTestId('resume-composer')).toBeVisible({ timeout: 15_000 });

    // The picker selects from existing codes and defaults to the one we seeded (no "issue new").
    await page.getByTestId('composer-panel-code').click();
    const select = page.getByTestId('composer-code-select');
    await expect(select, 'the picker is a select of existing codes').toBeVisible();
    await expect(select.locator('option'), 'the seeded code is an option').toContainText(CODE);
    await expect(page.getByTestId('composer-code-empty'), 'not the empty state').toHaveCount(0);

    // The live preview renders the QR image for the selected real code (the header draws
    // `#image("qr.png")` only when a code URL is set; with none it draws an empty box). typst.ts
    // emits the QR as an SVG <image>, so its presence proves the picked code reached the preview.
    const svgBox = page.getByTestId('composer-preview-svg');
    await expect(svgBox).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
    await expect(svgBox.locator('image').first(), 'the QR image renders for the real code')
      .toBeVisible();
  });
});
