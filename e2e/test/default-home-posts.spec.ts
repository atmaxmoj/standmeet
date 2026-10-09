// default-home-posts.spec.ts —— the homepage a visitor lands on shows the owner's timeline.
//
// Two homepages carry it, and both are covered:
//   - DefaultHome: what `/` serves until the owner publishes their own `home` (rendered from
//     current code);
//   - the shipped `home` template the owner starts editing from (defaulthomepage/App.tsx), built
//     and published as a real microsite.
// A timeline with nothing to show stays out of the page (a fresh instance shows no "no posts yet"
// to visitors), like the corpus cards beside it. Once there are posts, an anonymous visitor sees
// the public one only — presence and absence on the same page.

import { test, expect } from '@/fixtures/test';
import type { Browser, Page } from '@playwright/test';

import { seedDefaultHomepage } from '@/fixtures/microsite-rig';
import { openHome } from '@/fixtures/navigate';
import { seedMatrix, setupPostsOwner, type PostsOwner, type Seeded } from '@/fixtures/posts';
import { timelineItems } from '@/fixtures/posts-ui';

let o: PostsOwner;
let s: Seeded;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => { o = await setupPostsOwner(playwright, 'homeposts'); });
test.afterAll(async () => { await o.request.dispose(); });

// anonymousHome —— a fresh visitor's browser on `/`.
async function anonymousHome(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await openHome(page);
  return page;
}

async function expectPublicOnly(page: Page, where: string): Promise<void> {
  await expect(timelineItems(page), `${where}: the public post is shown`).toHaveCount(1, { timeout: 30_000 });
  const text = await page.getByTestId('posts-widget').innerText();
  expect(text, `${where}: the public post`).toContain(s.m.pub);
  for (const k of ['priv', 'hir', 'hirInv'] as const) {
    expect(text.includes(s.m[k]), `${where}: never the ${k} post`).toBe(false);
  }
}

test('DefaultHome: no timeline before the first post, the public post after', async ({ browser }) => {
  const before = await (await browser.newContext()).newPage();
  // Presence: the timeline's own fetch answered (empty) — its absence below is then a decision, not
  // a page that never asked.
  const asked = before.waitForResponse((r) => r.url().includes('/api/v1/posts'), { timeout: 30_000 });
  await openHome(before);
  await expect(before.getByTestId('default-home'), 'presence: the default homepage is up').toBeVisible({ timeout: 20_000 });
  expect((await asked).status(), 'the timeline asked and was answered').toBe(200);
  await expect(before.getByTestId('posts-widget'), 'nothing to show → no timeline').toHaveCount(0);
  await before.context().close();

  s = await seedMatrix(o);
  const after = await anonymousHome(browser);
  await expect(after.getByTestId('default-home')).toBeVisible({ timeout: 20_000 });
  await expectPublicOnly(after, 'DefaultHome');
  await after.context().close();
});

test('the shipped home template, built and published, shows the same timeline', async ({ browser }) => {
  test.setTimeout(600_000);
  await seedDefaultHomepage(o.request, o.csrf);
  const page = await anonymousHome(browser);
  await expect(page.getByTestId('default-home'), 'the built page, not the fallback').toHaveCount(0);
  await expectPublicOnly(page, 'the published home template');
  await page.context().close();
});
