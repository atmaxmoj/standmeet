// posts-key-scopes.spec.ts —— posts-tests.md § H: the R7 danger classes apply to posts as to every
// genre. A `read` key lists and gets posts but cannot create or update one; a `read`+`write` key
// writes but cannot delete — delete needs `destructive`. Each refusal is paired with a full key
// doing the same call successfully, so a refusal cannot be a broken call.

import { test, expect } from '@/fixtures/test';

import { createAPIToken } from '@/fixtures/admin';
import { callTool, callToolOutcome, initMCP, type ToolOutcome } from '@/fixtures/mcp';
import { createPost, getPost, marker, setupPostsOwner, type PostsOwner, type PostView } from '@/fixtures/posts';

let o: PostsOwner;
let readKey = '';
let writeKey = '';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  o = await setupPostsOwner(playwright, 'postskeys');
  readKey = await createAPIToken(o.request, o.csrf, 'posts-read', ['read']);
  writeKey = await createAPIToken(o.request, o.csrf, 'posts-write', ['read', 'write']);
});
test.afterAll(async () => { await o.request.dispose(); });

async function as(key: string, tool: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const sid = await initMCP(o.request, key);
  return callToolOutcome(o.request, key, sid, tool, { genre: 'post', ...args });
}

function expectRefused(out: ToolOutcome, cls: string, what: string): void {
  expect(out.isError, `${what}: refused`).toBe(true);
  expect(out.text, `${what}: says why`).toMatch(/not allowed|scope/i);
  expect(out.text, `${what}: names the class it needs`).toContain(cls);
}

test('a read key lists and gets posts', async () => {
  const p = await createPost(o, { body: `readable ${marker('KEY')}`, visibility: 'private' });
  const sid = await initMCP(o.request, readKey);
  const list = await callTool<{ items: PostView[] }>(o.request, readKey, sid, 'corpus.list', { genre: 'post' });
  expect(list.items.map((x) => x.id), 'list').toContain(p.id);
  const got = await callTool<PostView>(o.request, readKey, sid, 'corpus.get', { genre: 'post', id: p.id });
  expect(got.body, 'get').toBe(p.body);
});

test('a read key cannot create or update a post', async () => {
  const p = await createPost(o, { body: `unchanged ${marker('KEY')}`, visibility: 'private' });
  expectRefused(await as(readKey, 'corpus.create', { body: 'nope', visibility: 'public' }), 'write', 'create');
  expectRefused(await as(readKey, 'corpus.update', { id: p.id, body: 'nope' }), 'write', 'update');
  expect((await getPost(o, p.id)).body, 'nothing changed').toBe(p.body);
  const ok = await as(writeKey, 'corpus.update', { id: p.id, body: `changed ${marker('KEY')}` });
  expect(ok.isError, 'a write key may update (presence)').toBe(false);
});

test('delete needs destructive: a write key is refused, a full key succeeds', async () => {
  const p = await createPost(o, { body: `to delete ${marker('KEY')}`, visibility: 'private' });
  const out = await as(writeKey, 'corpus.delete', { id: p.id });
  expectRefused(out, 'destructive', 'delete with a write key');
  expect((await getPost(o, p.id)).id, 'still there').toBe(p.id);
  const ok = await as(o.apiToken, 'corpus.delete', { id: p.id });
  expect(ok.isError, 'the full key deletes (presence)').toBe(false);
  await expect(getPost(o, p.id)).rejects.toThrow(/not found/i);
});
