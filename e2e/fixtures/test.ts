// test.ts —— custom Playwright test fixtures.
//
//   `page`       —— lands on root /. Visitor perspective.
//   `adminPage`  —— lands on /admin, auto-logged-in. Owner perspective.
//
// adminPage reads its login credentials from the `ownerCredentials` fixture —— each test file
// sets its own via test.use({ ownerCredentials: { email, password } }).
// If unset it falls back to alice@example.com (backward-compatible with old specs).
//
// Isolation model: each test file claims the instance with a different email, and the adminPage
// fixture logs in with that file's credentials. Playwright runs serially with 1 worker, and each
// file's beforeAll does resetInstance + claim.

import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Playwright 1.60 no longer named-exports the `Playwright` type; many old spots in the spec
// files write `playwright: Playwright`, and rewriting all 80+ import paths isn't worth it.
// This module augmentation adds the alias back —— taking it straight from PlaywrightWorker
// Args.playwright, to avoid depending on `typeof import('playwright-core')` literal
// resolution (an outer node_modules collided with an old copy, making tsc see a different
// type identity in different places).
declare module '@playwright/test' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  export type Playwright = import('@playwright/test').PlaywrightWorkerArgs['playwright'];
}

interface OwnerCredentials {
  email: string;
  password: string;
}

const DEFAULT_CREDENTIALS: OwnerCredentials = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
};

type Fixtures = {
  ownerCredentials: OwnerCredentials;
  adminPage: Page;
};

export const test = base.extend<Fixtures>({
  ownerCredentials: [DEFAULT_CREDENTIALS, { option: true }],

  page: async ({ page }, use) => {
    await page.goto('/');
    await use(page);
  },

  adminPage: async ({ page, ownerCredentials }, use) => {
    await page.goto('/admin');
    const loginEmail = page.getByTestId('email');
    // The signal that "admin is loaded" is **the shell being present**, not "that sidebar column is visible".
    // On a narrow screen the sidebar is a drawer, and when closed it is invisible by design; waiting only on
    // the sidebar makes every admin spec time out inside the fixture, and the red reports on the fixture,
    // looking like admin fails to render on mobile.
    // Either entry point being **visible** is enough: desktop shows the sidebar, narrow shows the toggle.
    //
    // Don't write it as `a.or(b).first()`: `or` picks by DOM order, and the top-bar toggle comes before the
    // sidebar —— on desktop it is `lg:hidden` (display:none) yet still in the DOM, so `.first()` always picks
    // that never-visible element and the whole admin suite times out ([[geometry-sees-one-element]]'s cousin:
    // what the selector matches is not what the human sees). We want "whichever is visible first", so each must wait on its own.
    const shellReady = () => Promise.race([
      page.getByTestId('admin-nav-account').waitFor({ state: 'visible', timeout: 15_000 }),
      page.getByTestId('admin-nav-toggle').waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    await Promise.race([
      loginEmail.waitFor({ state: 'visible', timeout: 15_000 }),
      shellReady(),
    ]);
    if (await loginEmail.isVisible()) {
      await loginEmail.fill(ownerCredentials.email);
      await page.getByTestId('password').fill(ownerCredentials.password);
      await page.getByTestId('submit').click();
      // In sweep mode, 372 specs run serially and admin login + first-paint render can get
      // dragged past 10s under resource pressure; exceeding the default actionTimeout=10s causes
      // sporadic flakes (several sweep runs of admin-wiki-crud / admin-seo hit this). 30s leaves headroom.
      await shellReady();
    }
    await use(page);
  },
});

export { expect };
export type { Page, APIRequestContext, Browser } from '@playwright/test';
