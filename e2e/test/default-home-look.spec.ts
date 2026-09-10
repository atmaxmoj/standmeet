// default-home-look.spec.ts —— screenshot-observe the new DefaultHome (Q1). It renders as the
// visitor fallback (e.g. /c/<slug> with no session), so we can see whether the SDK widgets (ask box,
// insights, gate, page-nav) render cleanly in the app before the backend serve-on-empty change. NO
// assertions beyond "it mounted". Artifact → e2e/manual-runs/default-home-look.png.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { seedWiki, publishEntry } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { openReader } from '@/fixtures/navigate';

const OWNER = {
  email: 'defaulthome@example.com', password: 'correct-horse-battery-staple',
  handle: 'defaulthome', fullName: 'Default Home Owner',
};

test.describe('DefaultHome look (screenshot, observe)', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'defaulthome-seed');
    const sid = await initMCP(request, token);
    for (const title of ['Cognitive Science', 'Cognitive Dissonance', 'Mere Exposure']) {
      const note = await seedWiki(request, token, sid, { title, body: `${title} — a note about it.` });
      await publishEntry(request, token, sid, { genre: 'wiki', id: note.wikiID, excerpt: `${title} excerpt` });
    }
    await request.dispose();
  });

  test('DefaultHome renders the widgets (no session)', async ({ page }) => {
    test.setTimeout(60_000);
    await openReader(page, '/c/observe'); // no session → visitor fallback → DefaultHome
    await expect(page.getByTestId('default-home')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('corpus-widget')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'manual-runs/default-home-look.png', fullPage: true });
  });
});
