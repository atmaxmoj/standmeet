// upgrade-posts.spec.ts —— posts-tests.md § L: an old volume + new code: the deploy carries posts
// (`2026-10-08-posts.sql`: the posts table; asset_references gains the referrer kind `post`).
//
// Method (mirrors upgrade-corpus-trash): on a DB with a corpus, a referenced pool image and a
// trashed note, roll back to the pre-posts shape — drop the table and forget the ledger row of this
// migration AND of every later migration that touches posts (a later one would otherwise stay
// "applied" against a table that no longer exists) — then restart the backend (= deploy).
//
// What the upgrade must keep: the corpus, the pool, its references and the trash, untouched. What it
// must add: a working posts genre, the image guard for a post's image, and a boot index rebuild that
// indexes public / roles posts and never a private one.
//
// Serial: the DB is briefly in the old shape mid-run. Do not parallelize.

import { test, expect } from '@/fixtures/test';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { execSQL, querySQL, restartBackend } from '@/fixtures/instance';
import { callTool, callToolOutcome, initMCP } from '@/fixtures/mcp';
import { MEDIA } from '@/fixtures/genre-assets';
import { createPost, deletePost, marker, setupPostsOwner, type PostsOwner } from '@/fixtures/posts';

const MIGRATION = '2026-10-08-posts.sql';
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/db/migrations');
const MEILI = `${process.env['COMPOSE_PROJECT_NAME'] ?? 'standmeet-dev'}-meilisearch-1`;
const MEILI_KEY = 'standmeet_dev_meili_key';

function count(sql: string): number {
  return Number(querySQL(sql));
}

// postsMigrations —— this migration and every later one whose text names the posts table.
function postsMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql') && f >= MIGRATION)
    .filter((f) => f === MIGRATION || /\bposts\b/i.test(readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')));
}

// meiliHits —— the hits (never the whole response: it echoes the query) of the visitor index for one
// token, from inside its container.
function meiliHits(q: string): string {
  const raw = execSync(
    `docker exec ${MEILI} curl -s -X POST -H 'Authorization: Bearer ${MEILI_KEY}' ` +
    `-H 'Content-Type: application/json' -d '${JSON.stringify({ q })}' ` +
    'http://localhost:7700/indexes/corpus_notes/search',
    { encoding: 'utf-8' },
  );
  return JSON.stringify((JSON.parse(raw) as { hits?: unknown[] }).hits ?? []);
}

let o: PostsOwner;
let assetID = '';
const before = { notes: 0, refs: 0, trash: 0 };

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => {
  o = await setupPostsOwner(playwright, 'postsupg');
  const call = <T>(name: string, args: Record<string, unknown>): Promise<T> => callTool<T>(o.request, o.apiToken, o.sid, name, args);
  assetID = (await call<{ asset_id: string }>('assets.pool_upload',
    { url: MEDIA.pixel, filename: 'pre-posts.png' })).asset_id;
  await call('corpus.create', { genre: 'wiki', title: 'Pre-posts Note', body: `![pic](standmeet-asset:${assetID})` });
  const gone = await call<{ id: string }>('corpus.create', { genre: 'wiki', title: 'Pre-posts Trashed', body: 't' });
  await call('corpus.delete', { genre: 'wiki', id: gone.id });
});

test.afterAll(async () => {
  restartBackend();
  await o.request.dispose();
});

test('an old volume + a deploy → the posts table arrives; corpus, pool, references and trash untouched', () => {
  execSQL('DROP TABLE IF EXISTS posts CASCADE');
  execSQL("DELETE FROM asset_references WHERE referrer_kind = 'post'");
  const forget = postsMigrations().map((f) => `'${f}'`).join(',');
  execSQL(`DELETE FROM schema_migrations WHERE name IN (${forget})`);
  expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='posts'`),
    'pre-state not built: the table is still there').toBe(0);
  before.notes = count('SELECT count(*) FROM corpus_notes');
  before.refs = count('SELECT count(*) FROM asset_references');
  before.trash = count('SELECT count(*) FROM corpus_trash');
  expect(before.refs, 'the seeded reference is there').toBeGreaterThan(0);
  expect(before.trash, 'the seeded trash is there').toBeGreaterThan(0);

  restartBackend();

  expect(count(`SELECT count(*) FROM information_schema.tables WHERE table_name='posts'`)).toBe(1);
  expect(count(`SELECT count(*) FROM schema_migrations WHERE name = '${MIGRATION}'`)).toBe(1);
  expect(count('SELECT count(*) FROM corpus_notes'), 'every note survives').toBe(before.notes);
  expect(count('SELECT count(*) FROM asset_references'), 'every reference survives').toBe(before.refs);
  expect(count('SELECT count(*) FROM corpus_trash'), 'the trash survives').toBe(before.trash);
});

test('…a post can cite a pre-upgrade image, and the pool refuses to delete it, naming the post', async () => {
  o.sid = await initMCP(o.request, o.apiToken);
  const post = await createPost(o, { body: `old picture ![pic](standmeet-asset:${assetID})`, visibility: 'public' });
  const refused = await callToolOutcome(o.request, o.apiToken, o.sid, 'assets.pool_delete', { asset_id: assetID });
  expect(refused.isError, 'a referenced image is not deletable').toBe(true);
  expect(refused.text, 'the refusal names the post').toContain(post.id);
  await deletePost(o, post.id);
});

test('…the boot index rebuild indexes public and roles posts, never a private one', async () => {
  const m = { pub: marker('UPGPUB'), hir: marker('UPGHIR'), priv: marker('UPGPRIV') };
  await createPost(o, { body: `public ${m.pub}`, visibility: 'public' });
  await createPost(o, { body: `hiring ${m.hir}`, visibility: 'roles', visible_role_ids: [o.roles.hiring] });
  await createPost(o, { body: `private ${m.priv}`, visibility: 'private' });
  // Empty the index, then deploy: whatever is in it afterwards came from the boot rebuild.
  execSync(`docker exec ${MEILI} curl -s -X DELETE -H 'Authorization: Bearer ${MEILI_KEY}' ` +
    'http://localhost:7700/indexes/corpus_notes/documents');
  restartBackend();

  await expect.poll(() => meiliHits(m.pub), { timeout: 60_000 }).toContain(m.pub);
  await expect.poll(() => meiliHits(m.hir), { timeout: 60_000, message: 'a roles post is indexed' }).toContain(m.hir);
  expect(meiliHits(m.priv), 'a private post is never indexed').not.toContain(m.priv);
});
