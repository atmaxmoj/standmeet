// posts-lifecycle.spec.ts —— posts-tests.md § C: a post's life — create, edit, change audience,
// delete, restore, purge — and what each step does to every reader.
//
// Contract choices (posts.md leaves them open; these follow the existing genres):
//   • posts are not in the search index: a visitor's corpus_search reads them from Postgres through
//     the post's audience (posts.md, "Who reads what"), so a change shows on the very next read —
//     there is no receipt to wait on, and no sleep.
//   • corpus.trash lists trashed posts with `genre: "post"`; corpus.restore takes {genre:'post', id}.
//   • the daily purge is the existing `corpus trash purge` periodic task; it drops posts too.
//   • a role deleted while a `roles` post names it leaves the list (role_delete over MCP).
// Two non-API steps, as in corpus-trash.spec: winding a trashed post's clock back, and setting two
// posts to the same created_at to see the tie-break (there is no endpoint for either, nor should be).

import { test, expect } from '@/fixtures/test';

import { createCode, revokeCode } from '@/fixtures/codes';
import { execSQL } from '@/fixtures/instance';
import { callTool } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import {
  createPost, deletePost, getPost, has, marker, setupPostsOwner, timelineText, turnRaw, updatePost,
  visitorToolRaw, type PostsOwner, type PostView,
} from '@/fixtures/posts';
import { timelineItems } from '@/fixtures/posts-lifecycle';
import { createRole } from '@/fixtures/roles';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const TRASH_DAYS = 90;

interface TrashItem { id: string; genre: string }

let o: PostsOwner;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.beforeAll(async ({ playwright }) => { o = await setupPostsOwner(playwright, 'postslife'); });
test.afterAll(async () => { await o.request.dispose(); });

function session(code = ''): Promise<VisitorSession> {
  return issueSession(o.request, code
    ? { handle: o.handle, code, visitor_name: 'v' }
    : { handle: o.handle, mode: 'public', visitor_name: 'v' });
}

function update(id: string, patch: Record<string, unknown>): Promise<PostView> {
  return updatePost(o, id, patch);
}

// searchText —— a session's corpus_search for one term, raw.
async function searchText(sess: VisitorSession, term: string): Promise<string> {
  return (await visitorToolRaw(o.request, sess, 'corpus_search', { query: term })).text;
}

async function readText(sess: VisitorSession, id: string): Promise<string> {
  return (await visitorToolRaw(o.request, sess, 'corpus_read', { path: `posts/${id}` })).text;
}

async function postsInTrash(): Promise<string[]> {
  const t = await callTool<{ items: TrashItem[] }>(o.request, o.apiToken, o.sid, 'corpus.trash', {});
  return t.items.filter((i) => i.genre === 'post').map((i) => i.id);
}

function restore(id: string): Promise<unknown> {
  return callTool(o.request, o.apiToken, o.sid, 'corpus.restore', { genre: 'post', id });
}

test('newest first, a created_at tie ordered by id, and an edit keeps the time and says "edited"', async () => {
  const a = await createPost(o, { body: `first ${marker('ORD')}`, visibility: 'public' });
  const b = await createPost(o, { body: `second ${marker('ORD')}`, visibility: 'public' });
  const c = await createPost(o, { body: `third ${marker('ORD')}`, visibility: 'public' });
  let ids = (await timelineItems(o.request)).map((p) => p.id);
  expect(ids.indexOf(c.id), 'newest first').toBeLessThan(ids.indexOf(b.id));
  expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));

  // Two posts made in the same instant: both times move together, so neither reads as edited.
  execSQL(`UPDATE posts SET created_at = '2026-01-01T00:00:00Z', updated_at = '2026-01-01T00:00:00Z' WHERE id IN ('${a.id}', '${b.id}')`);
  ids = (await timelineItems(o.request)).map((p) => p.id);
  const [hi, lo] = [a.id, b.id].sort().reverse();
  expect(ids.indexOf(hi!), 'a tie on created_at: the larger id first').toBeLessThan(ids.indexOf(lo!));

  const before = await getPost(o, c.id);
  const edited = await update(c.id, { body: `third, revised ${marker('ORD')}` });
  expect(edited.created_at, 'an edit leaves the post time alone').toBe(before.created_at);
  expect(edited.updated_at).not.toBe(before.created_at);
  const items = await timelineItems(o.request);
  const shown = items.find((p) => p.id === c.id);
  expect(shown?.edited, 'the timeline marks the edited post').toBe(true);
  expect(shown?.created_at, 'and still shows its original time').toBe(before.created_at);
  expect(items.find((p) => p.id === b.id)?.edited, 'an untouched post is not "edited"').toBe(false);
});

test('narrow public → private: gone from every anonymous path; widen private → public: back', async () => {
  const kw = marker('NARROWKW');
  const p = await createPost(o, { body: `Going quiet soon ${kw} ${marker('N')}`, visibility: 'public' });
  const pub = await session();
  expect(has(await searchText(pub, kw), p.id), 'searchable while public (presence)').toBe(true);

  await update(p.id, { visibility: 'private' });
  const sentinel = await createPost(o, { body: `Still public ${kw}`, visibility: 'public' });
  const found = await searchText(pub, kw);
  expect(has(found, sentinel.id), 'the same search still answers (presence)').toBe(true);
  expect(has(found, p.id), 'the narrowed post is out of search').toBe(false);
  expect(has((await timelineText(o.request)).text, p.body), 'out of the anonymous timeline').toBe(false);
  expect(has(await readText(pub, p.id), p.body), 'corpus_read refuses it').toBe(false);

  await update(p.id, { visibility: 'public' });
  expect(has(await searchText(pub, kw), p.id), 'widened: searchable again').toBe(true);
  expect(has((await timelineText(o.request)).text, p.body), 'widened: on the timeline').toBe(true);
  expect(has(await readText(pub, p.id), p.body), 'widened: readable').toBe(true);
});

test('narrowing is not retroactive: the conversation keeps what it was shown, new reads are refused', async () => {
  const m = marker('RETRO');
  const p = await createPost(o, {
    body: `For recruiters only ${m}`, visibility: 'roles', visible_role_ids: [o.roles.hiring],
  });
  const pub = await createPost(o, { body: `Public ${marker('RETROPUB')}`, visibility: 'public' });
  const sess = await session(o.codes.hiring);
  const tag = await scriptMockToolCall(o.request, { name: 'corpus_read', args: { path: `posts/${p.id}` } });
  const turn = await turnRaw(o.request, sess, `what is new for recruiters${tag}`);
  expect(has(turn.text, m), 'the visitor was shown the post').toBe(true);

  await update(p.id, { visibility: 'private' });

  const hist = await o.request.get(`${BACKEND}/api/v1/conversations/${sess.conversation_id}`,
    { headers: { Authorization: `Bearer ${sess.session_token}` } });
  expect(hist.status()).toBe(200);
  expect(has(await hist.text(), m), 'their history still holds what they were shown').toBe(true);
  expect(has(await readText(sess, pub.id), pub.body), 'the session still reads (presence)').toBe(true);
  expect(has(await readText(sess, p.id), m), 'a new read of the narrowed post is refused').toBe(false);
});

test('roles → another role list: the old role loses it, the new one gains it', async () => {
  const p = await createPost(o, {
    body: `Moving audience ${marker('MOVE')}`, visibility: 'roles', visible_role_ids: [o.roles.hiring],
  });
  const hiring = await session(o.codes.hiring);
  const invited = await session(o.codes.invited);
  expect(has((await timelineText(o.request, hiring.session_token)).text, p.body)).toBe(true);
  expect(has((await timelineText(o.request, invited.session_token)).text, p.body)).toBe(false);

  await update(p.id, { visible_role_ids: [o.roles.invited] });

  expect(has((await timelineText(o.request, hiring.session_token)).text, p.body), 'hiring lost it').toBe(false);
  expect(has((await timelineText(o.request, invited.session_token)).text, p.body), 'invited gained it').toBe(true);
});

test('delete → gone from readers, in the trash; restore → same audience and place', async () => {
  const kw = marker('DELKW');
  const p = await createPost(o, { body: `Soon deleted ${kw}`, visibility: 'public' });
  const after = await createPost(o, { body: `Posted after ${kw}`, visibility: 'public' });
  const pub = await session();
  const order = (await timelineItems(o.request)).map((x) => x.id);

  await deletePost(o, p.id);

  const found = await searchText(pub, kw);
  expect(has(found, after.id), 'the search answers (presence)').toBe(true);
  expect(has(found, p.id), 'the deleted post is out of search').toBe(false);
  expect(has((await timelineText(o.request)).text, p.body), 'off the timeline').toBe(false);
  expect(has(await readText(pub, p.id), p.body), 'not readable').toBe(false);
  await expect(getPost(o, p.id), 'the owner gets "not found" too').rejects.toThrow(/not found/i);
  expect(await postsInTrash(), 'the trash lists it as a post').toContain(p.id);

  await restore(p.id);

  expect((await getPost(o, p.id)).visibility, 'restored with its audience').toBe('public');
  const back = (await timelineItems(o.request)).map((x) => x.id);
  expect(back.indexOf(p.id), 'back in its old place, not on top').toBe(order.indexOf(p.id));
  expect(has(await searchText(pub, kw), p.id), 'back in search').toBe(true);
  expect(await postsInTrash()).not.toContain(p.id);
});

test(`the purge drops a post that has been in the trash longer than ${TRASH_DAYS} days`, async () => {
  const old = await createPost(o, { body: `old ${marker('OLD')}`, visibility: 'public' });
  const fresh = await createPost(o, { body: `fresh ${marker('FRESH')}`, visibility: 'public' });
  await deletePost(o, old.id);
  await deletePost(o, fresh.id);
  execSQL(`UPDATE posts SET deleted_at = now() - interval '${TRASH_DAYS + 1} days' WHERE id = '${old.id}'`);

  await callTool(o.request, o.apiToken, o.sid, 'tasks.run_periodic', { name: 'corpus trash purge' });

  await expect.poll(async () => (await postsInTrash()).includes(old.id), { timeout: 30_000 }).toBe(false);
  expect(await postsInTrash(), 'the fresh one waits (presence)').toContain(fresh.id);
  await expect(restore(old.id), 'a purged post is gone for good').rejects.toThrow(/not in the trash/i);
});

test('a deleted role leaves the list; the last one gone makes the post private, never public', async () => {
  const mk = async (name: string): Promise<string> =>
    (await createRole(o.request, o.csrf, { name, description: name, corpus_uris: [] })).id;
  const [r1, r2, r3] = [await mk('gone-one'), await mk('gone-two'), await mk('gone-three')];
  const shared = await createPost(o, { body: `shared ${marker('RD')}`, visibility: 'roles', visible_role_ids: [r1, o.roles.hiring] });
  const sole = await createPost(o, { body: `sole ${marker('RD')}`, visibility: 'roles', visible_role_ids: [r2] });
  const trashed = await createPost(o, { body: `trashed ${marker('RD')}`, visibility: 'roles', visible_role_ids: [r3] });
  const roleDelete = (id: string): Promise<unknown> =>
    callTool(o.request, o.apiToken, o.sid, 'role_delete', { role_id: id });

  await roleDelete(r1);
  await roleDelete(r2);
  expect((await getPost(o, shared.id)).visible_role_ids, 'the deleted role left the list').toEqual([o.roles.hiring]);
  const soleNow = await getPost(o, sole.id);
  expect(soleNow.visibility, 'its last role gone → private').toBe('private');
  const anon = (await timelineText(o.request)).text;
  expect(has(anon, sole.body), 'not public to anyone').toBe(false);

  await deletePost(o, trashed.id);
  await roleDelete(r3);
  await restore(trashed.id);
  expect((await getPost(o, trashed.id)).visibility, 'restored after its role went → private').toBe('private');
});

test('a code revoked mid-session: that session sees nothing more on its next read', async () => {
  const code = await createCode(o.request, o.csrf, {
    code: `${o.handle.toUpperCase()}-REVOKE`, label: 'revoke me', assumed_role_id: o.roles.hiring,
  });
  const p = await createPost(o, {
    body: `For recruiters ${marker('REV')}`, visibility: 'roles', visible_role_ids: [o.roles.hiring],
  });
  const sess = await session(code.code);
  expect(has((await timelineText(o.request, sess.session_token)).text, p.body), 'seen before (presence)').toBe(true);

  await revokeCode(o.request, o.csrf, code.id);

  expect(has((await timelineText(o.request, sess.session_token)).text, p.body), 'timeline after revoke').toBe(false);
  expect(has(await readText(sess, p.id), p.body), 'corpus_read after revoke').toBe(false);
  const other = await session(o.codes.hiring);
  expect(has((await timelineText(o.request, other.session_token)).text, p.body),
    'a live hiring session still sees it (presence)').toBe(true);
});
