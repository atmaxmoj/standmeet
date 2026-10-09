// admin-posts.spec.ts —— posts-tests.md § I: the owner's 动态 section in the admin panel.
//
// Driven as the owner drives it: compose with each visibility (the role multi-select exists only
// for `roles`), cite a pool image, see the post on top with its badge, change visibility inline,
// filter, search, delete → the trash's posts group → restore. Every UI action is checked against a
// receipt outside the UI (owner MCP read-back, the anonymous timeline). Empty and failed loads come
// from ListPane; the copy is checked in English and Chinese (the i18n key gate covers 9 locales).
// Contract (route, testids): fixtures/posts-ui.ts.

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { MEDIA } from '@/fixtures/genre-assets';
import { callTool } from '@/fixtures/mcp';
import { gotoAdminSection, openReader, reloadAdminSection } from '@/fixtures/navigate';
import {
  getPost, has, listAllPosts, marker, setupPostsOwner, timelineText, type PostsOwner, type Visibility,
} from '@/fixtures/posts';
import { ownerCreds } from '@/fixtures/posts-ui';

const HANDLE = 'adminposts';

let o: PostsOwner;
const made: Record<Visibility, { id: string; mark: string }> = {
  private: { id: '', mark: '' }, public: { id: '', mark: '' }, roles: { id: '', mark: '' },
};

test.use({ ownerCredentials: ownerCreds(HANDLE) });
test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => { o = await setupPostsOwner(playwright, HANDLE); });
test.afterAll(async () => { await o.request.dispose(); });

const rows = (page: Page) => page.locator('[data-testid^="post-row-"]');

// compose —— write one post in the composer; returns its id (read back over the owner's MCP).
async function compose(page: Page, body: string, mark: string, vis: Visibility, roleIDs: string[] = []): Promise<string> {
  await page.getByTestId('posts-composer-body').fill(body);
  await page.getByTestId('posts-composer-visibility').selectOption(vis);
  const roles = page.getByTestId('posts-composer-roles');
  if (vis === 'roles') {
    await expect(roles, 'the role multi-select appears for roles').toBeVisible();
    for (const id of roleIDs) await page.getByTestId(`posts-composer-role-${id}`).check();
  } else {
    await expect(roles, `no role multi-select for ${vis}`).toHaveCount(0);
  }
  await page.getByTestId('posts-composer-submit').click();
  let id = '';
  await expect.poll(async () => {
    id = (await listAllPosts(o)).find((p) => p.body.includes(mark))?.id ?? '';
    return id;
  }, { timeout: 15_000, message: 'the composed post was written' }).not.toBe('');
  await expect(rows(page).first(), 'the new post is on top').toHaveAttribute('data-testid', `post-row-${id}`);
  await expect(page.getByTestId(`post-visibility-${id}`)).toContainText(vis);
  return id;
}

test('empty first; compose private / public / roles — each lands on top with its badge', async ({ adminPage: page }) => {
  await gotoAdminSection(page, 'posts');
  await expect(page.getByTestId('posts-empty'), 'a fresh instance has no posts').toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('posts-composer-visibility'), 'private is the default').toHaveValue('private');
  for (const vis of ['private', 'public', 'roles'] as const) {
    const mark = marker(`ADM${vis.toUpperCase()}`);
    const roleIDs = vis === 'roles' ? [o.roles.hiring] : [];
    made[vis] = { mark, id: await compose(page, `A ${vis} post ${mark}`, mark, vis, roleIDs) };
    const back = await getPost(o, made[vis].id);
    expect(back.visibility, `receipt: ${vis}`).toBe(vis);
    expect(back.visible_role_ids, `receipt: role list of the ${vis} post`).toEqual(roleIDs);
  }
  await expect(page.getByTestId('posts-empty')).toHaveCount(0);
});

test('cite a pool image from the composer → the post shows it and references it', async ({ adminPage: page }) => {
  const asset = await callTool<{ asset_id: string }>(o.request, o.apiToken, o.sid, 'assets.pool_upload',
    { url: MEDIA.pixel, filename: 'composer-shot.png' });
  await gotoAdminSection(page, 'posts');
  await page.getByTestId('posts-composer-pool-toggle').click();
  await expect(page.getByTestId('posts-composer-pool-list')).toContainText('composer-shot.png', { timeout: 15_000 });
  const mark = marker('ADMIMG');
  await page.getByTestId('posts-composer-body').fill(`With a picture ${mark}\n\n`);
  await page.getByTestId(`posts-composer-pool-insert-${asset.asset_id}`).click();
  await expect(page.getByTestId('posts-composer-body')).toHaveValue(new RegExp(`standmeet-asset:${asset.asset_id}`));
  const id = await compose(page, await page.getByTestId('posts-composer-body').inputValue(), mark, 'private');
  const img = page.getByTestId(`post-row-${id}`).locator('img');
  await expect(img, 'the image renders in the row').toBeVisible({ timeout: 15_000 });
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth), 'the image loaded').toBeGreaterThan(0);
  const refs = await callTool<{ kind: string; referrer_id: string }[]>(o.request, o.apiToken, o.sid,
    'assets.references', { asset_id: asset.asset_id });
  expect(refs.map((r) => `${r.kind}:${r.referrer_id}`)).toContain(`post:${id}`);
});

test('change visibility inline: private → public reaches the anonymous timeline', async ({ adminPage: page }) => {
  const { id, mark } = made.private;
  expect(has((await timelineText(o.request)).text, mark), 'before: not public').toBe(false);
  await gotoAdminSection(page, 'posts');
  await page.getByTestId(`post-visibility-edit-${id}`).selectOption('public');
  await expect(page.getByTestId(`post-visibility-${id}`)).toContainText('public', { timeout: 15_000 });
  expect((await getPost(o, id)).visibility, 'receipt').toBe('public');
  expect(has((await timelineText(o.request)).text, mark), 'after: on the anonymous timeline').toBe(true);
  await page.getByTestId(`post-visibility-edit-${id}`).selectOption('private');
  await expect(page.getByTestId(`post-visibility-${id}`)).toContainText('private', { timeout: 15_000 });
});

test('filter by visibility and search narrow the timeline', async ({ adminPage: page }) => {
  await gotoAdminSection(page, 'posts');
  await page.getByTestId('posts-filter-visibility').selectOption('roles');
  await expect(page.getByTestId(`post-row-${made.roles.id}`), 'the roles post stays').toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`post-row-${made.public.id}`), 'the public post is filtered out').toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await page.getByTestId('posts-filter-visibility').selectOption('');
  await expect(page.getByTestId(`post-row-${made.public.id}`), 'all again').toBeVisible({ timeout: 15_000 });

  await page.getByTestId('posts-search').fill(made.public.mark);
  await expect(rows(page), 'search finds exactly the one post').toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId(`post-row-${made.public.id}`)).toBeVisible();
});

test('delete → the trash lists it in the posts group → restore → back with its badge', async ({ adminPage: page }) => {
  const { id, mark } = made.roles;
  await gotoAdminSection(page, 'posts');
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); void d.accept(); });
  await page.getByTestId(`post-delete-${id}`).click();
  await expect.poll(() => asked, { timeout: 5_000 }).toMatch(/trash.*90 days/i);
  await expect(page.getByTestId(`post-row-${id}`)).toHaveCount(0, { timeout: 15_000 });

  await gotoAdminSection(page, 'trash');
  const row = page.getByTestId('trash-posts').getByTestId(`trash-post-row-${id}`);
  await expect(row, 'the trash names the post by its text').toContainText(mark, { timeout: 15_000 });
  await page.getByTestId(`trash-post-restore-${id}`).click();
  await expect(row).toHaveCount(0, { timeout: 15_000 });

  await gotoAdminSection(page, 'posts');
  await expect(page.getByTestId(`post-visibility-${id}`), 'restored with its visibility').toContainText('roles',
    { timeout: 15_000 });
  expect((await getPost(o, id)).visible_role_ids, 'restored with its role list').toEqual([o.roles.hiring]);
});

test('a failed load says so, never "no posts"', async ({ adminPage: page }) => {
  let hits = 0;
  await page.route(/\/api\/admin\/corpus\/post/, (route) => {
    hits += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"message":"boom"}}' });
  });
  await reloadAdminSection(page, 'posts');
  await expect.poll(() => hits, { message: 'the list GET was intercepted' }).toBeGreaterThan(0);
  await expect(page.getByTestId('section-load-failed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('posts-empty')).toHaveCount(0);
});

test('the section speaks the UI language: posts / 动态', async ({ adminPage: page }) => {
  await openReader(page, '/admin/posts');
  await expect(page.getByTestId('admin-nav-posts')).toHaveText('posts', { timeout: 15_000 });
  await openReader(page, '/zh/admin/posts');
  await expect(page.getByTestId('admin-nav-posts')).toHaveText('动态', { timeout: 15_000 });
  await expect(page.getByTestId('section-header')).toContainText('动态');
  await expect(page.getByTestId('posts-composer-submit'), 'the composer is translated').toHaveText(/[一-鿿]/);
});
