// posts-assets.spec.ts —— posts-tests.md § E: images in posts reuse the global asset pool, and an
// image inherits the audience of the posts that cite it.
//
// Contract (defined while RED):
//   - a post cites a pool image as `standmeet-asset:<id>` in its body; on save the post becomes an
//     asset_references referrer of kind `post` (assets.references lists {kind:'post', referrer_id});
//   - a reader's view of a post (GET /api/v1/posts items, owner corpus.get) carries `asset_urls`:
//     {<asset id>: <signed serve URL>} for the images that post cites — the same shape writings use;
//   - assets.pool_delete on an image a post cites is refused, and the refusal says "post";
//   - a trashed post keeps its references (delete still refused); the corpus trash purge frees them.
//
// Every refusal below has its own presence in the same test: the public image streams to the same
// anonymous reader, and the owner's signed URL streams before its tampered twin is refused.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { MEDIA } from '@/fixtures/genre-assets';
import { execSQL } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';
import {
  createPost, deletePost, getPost, marker, setupPostsOwner, type PostsOwner,
} from '@/fixtures/posts';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const TRASH_DAYS = 90;

interface WithAssets { id: string; body: string; asset_urls?: Record<string, string> }

let o: PostsOwner;
let anon: APIRequestContext;
const tool = <T>(name: string, args: Record<string, unknown>) =>
  callTool<T>(o.request, o.apiToken, o.sid, name, args);
const upload = async (filename: string) =>
  (await tool<{ asset_id: string }>('assets.pool_upload', { url: MEDIA.pixel, filename })).asset_id;
const refs = (assetID: string) =>
  tool<{ kind: string; referrer_id: string }[]>('assets.references', { asset_id: assetID });
const status = async (r: APIRequestContext, url: string) =>
  (await r.get(new URL(url, BACKEND).toString(), { maxRedirects: 0 })).status();

// anonymousTimeline —— every post an anonymous reader is given, with its asset URLs.
async function anonymousTimeline(): Promise<WithAssets[]> {
  const res = await anon.get(`${BACKEND}/api/v1/posts?limit=50`);
  expect(res.status(), 'the anonymous timeline answers').toBe(200);
  return ((await res.json()) as { items: WithAssets[] }).items;
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  o = await setupPostsOwner(playwright, 'postsassets');
  anon = await playwright.request.newContext();
});

test.afterAll(async () => { await o.request.dispose(); await anon.dispose(); });

test('a public post\'s image streams to an anonymous reader; a private-only image does not', async () => {
  const pubImg = await upload('public.png');
  const privImg = await upload('private.png');
  const pubMark = marker('PUBIMG');
  const pub = await createPost(o, {
    body: `${pubMark} ![shot](standmeet-asset:${pubImg})`, visibility: 'public',
  });
  const priv = await createPost(o, {
    body: `${marker('PRIVIMG')} ![shot](standmeet-asset:${privImg})`, visibility: 'private',
  });

  // presence: the public post reaches the anonymous reader with a URL that streams its image.
  const seen = await anonymousTimeline();
  const pubURL = seen.find((p) => p.id === pub.id)?.asset_urls?.[pubImg] ?? '';
  expect(pubURL, 'the public post carries its image URL').not.toBe('');
  expect(await status(anon, pubURL), 'the public post\'s image streams anonymously').toBe(200);
  // absence: nothing the anonymous reader was given names the private image.
  expect(JSON.stringify(seen), 'the private image id is in no anonymous response').not.toContain(privImg);

  // a bare id is no key: the private-only image does not stream.
  expect(await status(anon, `/api/v1/assets/${privImg}`), 'bare id of a private-only image').toBe(404);

  // the owner's own view hands out a signed URL that streams (presence) …
  const ownerURL = (await getPost(o, priv.id) as WithAssets).asset_urls?.[privImg] ?? '';
  expect(ownerURL, 'the owner view carries the private image URL').not.toBe('');
  expect(await status(o.request, ownerURL), 'the owner\'s signed URL streams').toBe(200);
  // … and the same URL with its expiry rewritten is refused: the signature binds the expiry, so a
  // copied link cannot be re-dated. (A genuinely aged signature needs the clock an hour on; that
  // half is pinned by backend/internal/corpus/usecase/asset_url_token_test.go "expired rejects".)
  const expired = new URL(ownerURL, BACKEND);
  expired.searchParams.set('e', String(Math.floor(Date.now() / 1000) - 60));
  expect(await status(anon, expired.toString()), 'an expired signed URL').toBe(404);
});

test('the pool refuses to delete an image a post cites, naming the post', async () => {
  const img = await upload('cited.png');
  const post = await createPost(o, { body: `${marker('CITED')} ![c](standmeet-asset:${img})`, visibility: 'private' });

  await expect.poll(async () => (await refs(img)).map((r) => `${r.kind}:${r.referrer_id}`), { timeout: 15_000 })
    .toContain(`post:${post.id}`);
  await expect(tool('assets.pool_delete', { asset_id: img }), 'a cited image cannot leave the pool')
    .rejects.toThrow(/post/i);
  const pool = await tool<{ items: { asset_id: string }[] }>('assets.list', {});
  expect(pool.items.map((a) => a.asset_id), 'still in the pool after the refusal').toContain(img);
});

test('a trashed post keeps its reference; the purge frees the image', async () => {
  const img = await upload('trashed.png');
  const post = await createPost(o, { body: `${marker('TRASHED')} ![t](standmeet-asset:${img})`, visibility: 'public' });
  await deletePost(o, post.id);

  expect((await refs(img)).map((r) => r.referrer_id), 'the trashed post still references it').toContain(post.id);
  await expect(tool('assets.pool_delete', { asset_id: img }), 'still refused while the post is in the trash')
    .rejects.toThrow(/post/i);

  execSQL(`UPDATE posts SET deleted_at = now() - interval '${TRASH_DAYS + 1} days' WHERE id = '${post.id}'`);
  await tool('tasks.run_periodic', { name: 'corpus trash purge' });

  await expect.poll(async () => (await refs(img)).length, { timeout: 30_000, message: 'the purge drops the reference' })
    .toBe(0);
  await tool('assets.pool_delete', { asset_id: img });
  const pool = await tool<{ items: { asset_id: string }[] }>('assets.list', {});
  expect(pool.items.map((a) => a.asset_id), 'a freed image deletes').not.toContain(img);
});
