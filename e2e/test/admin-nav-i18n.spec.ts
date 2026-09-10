// admin-nav-i18n.spec.ts — the admin sidebar nav (section labels + group headers) and the section
// heading are translated, not hardcoded English.
//
// Regression: the section names lived as literal strings in lib/admin/nav.ts, so the whole left nav
// + the big heading stayed English on a Chinese instance while everything else translated. They now
// resolve from the adminNav catalog via t(), so they follow the UI language. The jsx-text-only i18n
// gate could never have caught this (the strings were in a .ts data module, and rendered via
// `{expr}`, not JSX text) — so this test is the guard.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'navi18n@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'navi18n',
  fullName: 'Nav i18n Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('admin nav + section heading are translated', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('English by default; Chinese under /zh — sidebar labels, group headers, and the heading',
    async ({ adminPage: page }) => {
      // Baseline: English.
      await openReader(page, '/admin/dashboard');
      await expect(page.getByTestId('admin-nav-raw'), 'en nav label').toHaveText('raw');
      await expect(page.getByTestId('admin-nav-output'), 'en: output slug shows "outputs"').toHaveText('outputs');
      await expect(page.getByTestId('section-header'), 'en heading').toContainText('dashboard');

      // Chinese via the URL locale prefix — the same page renders translated.
      await openReader(page, '/zh/admin/dashboard');
      await expect(page.getByTestId('admin-nav-raw'), 'zh nav label').toHaveText('原始');
      await expect(page.getByTestId('admin-nav-output'), 'zh: output section name').toHaveText('输出');
      await expect(page.getByTestId('admin-nav-microsites')).toHaveText('微站');
      // A group header (corpus → 语料库) is translated too.
      await expect(page.getByTestId('admin-sidebar'), 'zh group header').toContainText('语料库');
      // The big section heading follows the same catalog entry as the sidebar label.
      await expect(page.getByTestId('section-header'), 'zh heading').toContainText('仪表盘');

      // Dashboard body copy is translated too (KPI tile labels + a card header) — these used to be
      // hardcoded English in the view/data modules (dashboard-view.ts, use-admin-dashboard.ts).
      await expect(page.getByTestId('kpi-entries'), 'zh KPI label').toContainText('条目');
      await expect(page.getByTestId('dash-corpus-pulse'), 'zh card header').toContainText('语料库脉搏');
    });
});
