// posts-paging.spec.ts —— posts-tests.md § G: an anonymous reader paging the timeline over 250
// posts of mixed visibility gets every public post exactly once, in order, never an empty page made
// by hidden posts, and a `total` that counts only what it may see. A post written between two page
// fetches neither repeats nor pushes an older one out of the walk.

import { test, expect } from '@/fixtures/test';

import { createPost, marker, setupPostsOwner, type PostsOwner, type PublicPost } from '@/fixtures/posts';
import { timelinePage } from '@/fixtures/posts-lifecycle';

const N = 250;
const LIMIT = 20;

let o: PostsOwner;
const publicIDs = new Set<string>();

test.describe.configure({ mode: 'serial', timeout: 600_000 });

// Every third post public, the rest split between private and roles=[hiring] — long hidden runs,
// so a pager that filters after LIMIT returns empty or short pages.
test.beforeAll(async ({ playwright }) => {
  o = await setupPostsOwner(playwright, 'postspage');
  for (let i = 0; i < N; i++) {
    const kind = i % 3;
    const p = await createPost(o, kind === 0
      ? { body: `public ${i} ${marker('PG')}`, visibility: 'public' }
      : kind === 1
        ? { body: `private ${i} ${marker('PG')}`, visibility: 'private' }
        : { body: `hiring ${i} ${marker('PG')}`, visibility: 'roles', visible_role_ids: [o.roles.hiring] });
    if (kind === 0) publicIDs.add(p.id);
  }
});
test.afterAll(async () => { await o.request.dispose(); });

// newestFirst —— created_at desc, then id desc (posts.md § Data shape).
function newestFirst(a: PublicPost, b: PublicPost): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

test('every public post exactly once, in order, no empty page, total = what the reader may see', async () => {
  const seen: PublicPost[] = [];
  let cursor = '';
  let total = -1;
  for (let i = 0; i < 100; i++) {
    const page = await timelinePage(o.request, { cursor, limit: LIMIT });
    if (total < 0) total = page.total ?? -1;
    if (page.next_cursor) expect(page.items.length, `page ${i} is full though more follow`).toBe(LIMIT);
    expect(page.items.length, `page ${i} is not empty`).toBeGreaterThan(0);
    seen.push(...page.items);
    if (!page.next_cursor) break;
    cursor = page.next_cursor;
  }
  const ids = seen.map((p) => p.id);
  expect(new Set(ids).size, 'no post twice').toBe(ids.length);
  expect(new Set(ids), 'exactly the public posts').toEqual(publicIDs);
  expect(seen, 'newest first, ties by id').toEqual([...seen].sort(newestFirst));
  expect(total, 'total counts only what an anonymous reader may see').toBe(publicIDs.size);
});

test('a post written between two page fetches neither repeats nor skips one', async () => {
  const first = await timelinePage(o.request, { limit: LIMIT });
  const fresh = await createPost(o, { body: `written mid-walk ${marker('MID')}`, visibility: 'public' });
  const rest: PublicPost[] = [];
  let cursor = first.next_cursor ?? '';
  for (let i = 0; cursor && i < 100; i++) {
    const page = await timelinePage(o.request, { cursor, limit: LIMIT });
    rest.push(...page.items);
    cursor = page.next_cursor ?? '';
  }
  const walked = [...first.items, ...rest].map((p) => p.id);
  expect(walked, 'the new post is not inside a walk that started before it').not.toContain(fresh.id);
  expect(new Set(walked).size, 'no repeats').toBe(walked.length);
  expect(new Set(walked), 'no skips: the walk is exactly the posts that existed when it began').toEqual(publicIDs);
  const top = await timelinePage(o.request, { limit: LIMIT });
  expect(top.items[0]?.id, 'a fresh walk shows it on top (presence)').toBe(fresh.id);
});
