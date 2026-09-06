// coded-landing-slug.spec.ts —— Spec 1b: each access code carries its own /c/<slug> landing path.
// After a visitor redeems a code the URL is rewritten to /c/<slug> — the raw code leaves the address
// bar and the conversation gets a stable path. The slug is a LOCATOR, not a credential: visiting
// /c/<slug> with no session grants nothing.

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'slug-landing@example.com', password: 'correct-horse-battery-staple',
  handle: 'slugowner', fullName: 'Slug Owner',
};
const CODE = 'SLUG-LANDING1';
const NAME = 'Recruiter Slug';

test.describe('coded landing · the code carries its own /c/<slug> path (Spec 1b)', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('D1: absorbing ?code= rewrites the URL to /c/<slug> and drops the raw code', async ({ page }) => {
    test.setTimeout(60_000);
    await enterCodeSession(page, CODE, NAME);
    // The visitor is in a live chat...
    await expect(page.getByTestId('chat-input-field'),
      'the coded visitor lands in a usable chat').toBeEnabled({ timeout: 20_000 });
    // ...and the URL is now /c/<slug>, carrying no raw code.
    await page.waitForURL(/\/c\/[^/?#]+$/, { timeout: 10_000 });
    const url = new URL(page.url());
    expect(url.pathname, 'landed on a /c/<slug> path').toMatch(/^\/c\/.+/);
    expect(url.search, 'the raw code is gone from the URL').not.toContain('code=');
  });

  test('D3: /c/<slug> with no session grants no access — a locator, not a credential', async ({ page }) => {
    test.setTimeout(60_000);
    // A fresh visitor (no stored session) opens a code landing path directly.
    await goto(page, '/c/some-locator');
    // They land on the identity fallback, not a chat: the slug alone unlocks nothing.
    await expect(page.getByTestId('home-fallback'),
      'a slug-only visit shows the identity fallback').toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('chat-input-field'),
      'no chat is granted without a session').toHaveCount(0);
  });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'slug-seed');
  const sid = await initMCP(request, token);
  await seedPublicWiki(request, token, sid, { body: 'slug intro.', title: 'Slug Intro' });
  await createCode(request, csrf,
    { code: CODE, label: 'Slug link', max_turns_per_session: 50, max_members: 10 });
  await request.dispose();
}
