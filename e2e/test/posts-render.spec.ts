// posts-render.spec.ts —— posts-tests.md § F: a post body is rendered, never executed.
//
// One public post carries a `<script>`, an `onerror` image and a `javascript:` link (each would set
// its own window flag if it ran) next to a markdown heading and a KaTeX formula. It is rendered in
// the three places a body reaches a screen — the SDK <Posts /> on a microsite, the admin timeline,
// and a visitor answer that read the post and quotes it — and in each one:
//   presence: the marker, the heading and the formula render (the body really reached the screen);
//   absence:  no flag is set, and no link on the page points at `javascript:`.
// Contract (testids, SDK names): fixtures/posts-ui.ts.

import { test, expect } from '@/fixtures/test';
import type { Locator, Page } from '@playwright/test';

import { scriptMockReplyText, scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { publishPage } from '@/fixtures/microsite-rig';
import { enterCodeSession, gotoAdminSection, openReader } from '@/fixtures/navigate';
import { createPost, marker, setupPostsOwner, type PostsOwner } from '@/fixtures/posts';
import { ownerCreds, POSTS_PAGE, readXSSFlags, timelineItems, xssBody } from '@/fixtures/posts-ui';

const HANDLE = 'postsrender';
const SLUG = 'feed';
const MARK = marker('XSS');

let o: PostsOwner;
let postID = '';

test.use({ ownerCredentials: ownerCreds(HANDLE) });
test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(420_000);
  o = await setupPostsOwner(playwright, HANDLE);
  postID = (await createPost(o, { body: xssBody(MARK), visibility: 'public' })).id;
  await publishPage(o.request, o.csrf, SLUG, POSTS_PAGE);
});

test.afterAll(async () => { await o.request.dispose(); });

// expectRenderedInert —— the body rendered (heading, formula, marker) and nothing in it ran.
async function expectRenderedInert(page: Page, scope: Locator, where: string): Promise<void> {
  await expect(scope, `${where}: the post reached the screen`).toContainText(MARK, { timeout: 30_000 });
  await expect(scope.locator('h2', { hasText: `Heading_${MARK}` }), `${where}: markdown heading`).toHaveCount(1);
  await expect(scope.locator('.katex').first(), `${where}: KaTeX formula`).toBeVisible();
  await expect(scope.getByText('click me').first(), `${where}: the link text survives`).toBeVisible();
  expect(await readXSSFlags(page), `${where}: no payload ran`)
    .toEqual({ script: false, img: false, link: false });
  await expect(page.locator('a[href^="javascript:" i]'), `${where}: no javascript: link`).toHaveCount(0);
}

test('<Posts /> on a microsite renders the body inert', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await openReader(page, `/p/${SLUG}`);
  await expect(timelineItems(page), 'the anonymous timeline shows the public post').toHaveCount(1, { timeout: 30_000 });
  await expectRenderedInert(page, page.getByTestId(`posts-item-${postID}`), '<Posts />');
  await page.context().close();
});

test('the admin timeline renders the body inert', async ({ adminPage: page }) => {
  await gotoAdminSection(page, 'posts');
  await expectRenderedInert(page, page.getByTestId(`post-row-${postID}`), 'admin timeline');
});

test('a visitor answer that reads the post and quotes it renders inert', async ({ browser }) => {
  const read = await scriptMockToolCall(o.request, { name: 'corpus_read', args: { path: `posts/${postID}` } });
  const quote = await scriptMockReplyText(o.request, xssBody(MARK));
  const page = await (await browser.newContext()).newPage();
  await enterCodeSession(page, o.codes.hiring);
  const input = page.getByTestId('chat-input-field');
  await input.fill(`what did he post lately?${read}${quote}`);
  await input.press('Enter');
  await expectRenderedInert(page, page.getByTestId('answer-body').last(), 'visitor answer');
  await page.context().close();
});
