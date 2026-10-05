// scrollbars-follow-the-theme.spec.ts —— on a dark page a scroll area does not draw the light
// system scrollbar (owner 2026-10-04, a screenshot of a bright bar beside dark text:
// "scrolling bar能不能css上隐藏一下").
//
// Judged by computed style, not a screenshot: the page declares `color-scheme: dark` (so native
// bars and controls follow the palette) and every element inherits a scrollbar colour from the
// theme instead of the browser default `auto`.
//
// RED on v0.1.123: color-scheme stayed `normal` in dark mode and scrollbar-color was `auto`.

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openHome } from '@/fixtures/navigate';

test.describe('scrollbars follow the theme', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: 'scrollbar@example.com', password: 'correct-horse-battery-staple',
      handle: 'scrollbar', fullName: 'Scrollbar Owner',
    });
    await request.dispose();
  });

  test('a dark visitor page declares a dark color scheme and a themed scrollbar', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      try { window.localStorage.setItem('standmeet-dark', '1'); } catch { /* storage blocked */ }
    });
    await openHome(page);
    const style = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const answerArea = document.querySelector('[data-testid="chat-input-field"]') ?? document.body;
      return {
        scheme: root.colorScheme,
        rootBar: root.scrollbarColor,
        innerBar: getComputedStyle(answerArea).scrollbarColor,
        width: getComputedStyle(answerArea).scrollbarWidth,
      };
    });
    expect(style.scheme, 'native bars and controls follow the dark palette').toBe('dark');
    expect(style.rootBar, 'the page sets a scrollbar colour').not.toBe('auto');
    expect(style.innerBar, 'a scroll area inside the page inherits it').not.toBe('auto');
    expect(style.width, 'and it is thin').toBe('thin');
    await ctx.close();
  });
});
