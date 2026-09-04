// ui-locale-in-url.spec.ts — G (multi-language): the interface language lives in the URL and is
// switchable from the visitor top-right, and the choice persists.
//
// Three properties the owner asked for:
//   1. **In the URL**: `/gate` renders the English UI; `/zh/gate` renders the same page in Chinese,
//      and the language stays in the address bar (a shareable `/zh/…` link opens in Chinese).
//   2. **Top-right switcher**: the public page's top bar carries a language switch; clicking 中文
//      moves the URL under `/zh` and renders Chinese.
//   3. **Persists**: after switching, an un-prefixed page (a later click) stays in the chosen
//      language — the choice rode along in the NEXT_LOCALE cookie.
//
// The assertion strings are distinctive gate copy that differs by language, so seeing the Chinese
// one can only mean the Chinese catalog was actually loaded (not a fallback to the key path).

import { test, expect } from '@/fixtures/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'uilocale@example.com', password: 'correct-horse-battery-staple',
  handle: 'uilocale', fullName: 'UI Locale Owner',
};

// gate.hero.headline, per locale. Rendered as the gate's big headline. The en apostrophe is the
// typographic one (U+2019), matching the catalog exactly.
const EN_HEADLINE = 'This isn’t open';
const ZH_HEADLINE = '这里不对外开放';
const FR_HEADLINE = "Ce n'est pas ouvert";

test.describe('G · the UI language lives in the URL and is switchable', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    // login only to complete the claim flow deterministically; the tests are anonymous/visitor.
    await loginAPI(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test('`/gate` is English; `/zh/gate` is Chinese and the URL keeps the locale', async ({ page }) => {
    await goto(page, '/gate');
    await expect(page.getByText(EN_HEADLINE, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await goto(page, '/zh/gate');
    await expect(page.getByText(ZH_HEADLINE, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    expect(page.url(), 'the chosen language stays in the URL').toContain('/zh/gate');

    // The mechanism is locale-agnostic — a third language (fr) proves it generalizes past en/zh.
    await goto(page, '/fr/gate');
    await expect(page.getByText(FR_HEADLINE, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('/fr/gate');
  });

  test('the top-right switcher moves to 中文, and the choice persists to the next page',
    async ({ page }) => {
      // The switcher lives in the app TopBar (gate / readers). The index is a custom `home` page
      // now and doesn't carry the app TopBar, so drive the switcher from the gate.
      await goto(page, '/gate');
      const sw = page.getByTestId('locale-switch');
      await expect(sw).toBeVisible({ timeout: 15_000 });

      // The switch is a compact disclosure — open it, then click 中文 (located by hrefLang, since
      // the options are next/link components that can't carry a testid).
      await sw.locator('summary').click();
      await sw.locator('[hreflang="zh"]').click();
      await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/zh(\/|$)/);

      // Persistence: navigate to an UN-prefixed page — the cookie carries the language, so the gate
      // still comes up in Chinese even without a /zh prefix on this URL.
      await goto(page, '/gate');
      await expect(page.getByText(ZH_HEADLINE, { exact: false }).first())
        .toBeVisible({ timeout: 15_000 });
    });
});
