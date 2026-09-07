// composer-qr-and-chrome.spec.ts —— the résumé composer's QR + chrome polish (owner review):
//  - the Header QR shows the REAL selected code as a scannable QRCode (an <svg> of modules), not the
//    placeholder box, and it renders EVEN when the name/contacts are empty (the QR is always on the
//    résumé — owner: "只有 header 别的 entry 填写了之后他自己才会显示" + "这个也是假的，不要假的");
//  - the "preview PDF" link carries the picked code, so the preview stamps that same real QR;
//  - the shell is full-bleed on the composer route (no left gutter — the canvas butts the sidebar);
//  - Puck's chrome accent is themed to StandMeet vermillion (its default azure blue is remapped).

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claimFreshOwner } from '@/fixtures/seed';
import { login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { goto } from '@/fixtures/navigate';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'composer-qr@example.com', password: 'correct-horse-battery-staple',
  handle: 'composerqr', fullName: 'Composer QR Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('composer QR shows the real code + themed chrome', () => {
  test.beforeAll(async ({ playwright }) => { await claimFreshOwner(playwright, OWNER); });

  test('real QR (even with empty name), preview carries the code, full-bleed + themed chrome',
    async ({ adminPage: page, playwright }) => {
      test.setTimeout(120_000);
      const api: APIRequestContext = await playwright.request.newContext();
      const { csrf } = await loginAPI(api, OWNER.email, OWNER.password);
      // An active code so the composer auto-selects it → the editor draws its real QR.
      await createCode(api, csrf, { code: 'HIRING-2026', label: 'hiring' });
      // A draft with an EMPTY identity (default) — the QR must still show.
      const created = await api.post(`${BACKEND}/api/admin/drafts`, {
        headers: { 'X-Csrftoken': csrf }, data: { company: 'Acme', role: 'Engineer' },
      });
      const id = (await created.json() as { id: string }).id;

      await goto(page, `/admin/edit-resume/${id}`);
      await expect(page.getByTestId('puck-resume-editor')).toBeVisible({ timeout: 30_000 });

      const canvas = page.frameLocator('iframe').first();
      // The Header renders even though the name is empty (because there's a QR to show).
      await expect(canvas.locator('[data-sec="header"]'), 'header shows for the QR even with empty name')
        .toHaveCount(1, { timeout: 15_000 });
      // The QR is a REAL scannable QRCode (an <svg> of many module rects), not the placeholder box.
      const qrSvg = canvas.locator('[data-sec="qr"] svg');
      await expect(qrSvg, 'the QR is a real QRCode svg, not the placeholder').toBeVisible({ timeout: 10_000 });
      expect(await qrSvg.locator('rect').count(),
        'a real QR has many modules (rects); the placeholder has none').toBeGreaterThan(20);

      // The preview link carries the picked code so the preview PDF stamps the same real QR.
      const previewHref = await page.getByTestId('composer-preview').getAttribute('href');
      expect(previewHref ?? '', 'preview link carries the code').toContain('code=HIRING-2026');

      // Full-bleed: the composer route drops the shell's left gutter (butts the sidebar).
      const padLeft = await page.locator('main').evaluate((el) => getComputedStyle(el).paddingLeft);
      expect(padLeft, 'composer route has no left gutter').toBe('0px');

      // Puck chrome themed: its azure accent resolves to the app's vermillion (red-dominant), not the
      // default azure blue (blue-dominant). Probe a real element so we read the resolved colour.
      const azure = await page.evaluate(() => {
        const el = document.createElement('div');
        el.style.color = 'var(--puck-color-azure-05)';
        document.body.appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove();
        return c;
      });
      const m = azure.match(/(\d+),\s*(\d+),\s*(\d+)/);
      expect(m, `puck azure resolves to a colour (got "${azure}")`).not.toBeNull();
      const [r, , b] = [Number(m![1]), Number(m![2]), Number(m![3])];
      expect(r, `puck accent is vermillion (red>blue), not azure blue (got "${azure}")`).toBeGreaterThan(b);
      await api.dispose();
    });
});
