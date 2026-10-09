// posts-validation.spec.ts —— posts-tests.md § D: input the owner's verbs must refuse, each with a
// readable message and nothing written; and an omitted visibility means private.
//
// "Another owner's role" is not reachable on a single-owner instance; a random uuid stands for every
// role id the owner does not have (both are "not one of your roles").

import { randomUUID } from 'node:crypto';

import { test, expect } from '@/fixtures/test';

import { listTools } from '@/fixtures/mcp';
import {
  createPost, createPostOutcome, getPost, has, listAllPosts, marker, setupPostsOwner, timelineText,
  updatePostOutcome, type PostsOwner,
} from '@/fixtures/posts';

let o: PostsOwner;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => { o = await setupPostsOwner(playwright, 'postsval'); });
test.afterAll(async () => { await o.request.dispose(); });

// A readable refusal: an error result whose text names the field, not a stack trace or a bare code.
function expectReadable(text: string, field: RegExp, what: string): void {
  expect(text, `${what}: names what is wrong`).toMatch(field);
  expect(text, `${what}: no stack trace`).not.toMatch(/panic|goroutine|\.go:\d+|SQLSTATE/);
}

const CREATE_REFUSALS: Array<{ what: string; args: Record<string, unknown>; field: RegExp }> = [
  { what: 'unknown visibility', args: { body: 'x', visibility: 'friends' }, field: /visibility/i },
  { what: 'roles with an empty list', args: { body: 'x', visibility: 'roles', visible_role_ids: [] }, field: /role/i },
  { what: 'a role id that is not one of yours', args: { body: 'x', visibility: 'roles', visible_role_ids: [randomUUID()] }, field: /role/i },
  { what: 'role ids with public', args: { body: 'x', visibility: 'public', visible_role_ids: ['$hiring'] }, field: /role/i },
  { what: 'role ids with private', args: { body: 'x', visibility: 'private', visible_role_ids: ['$hiring'] }, field: /role/i },
  { what: 'an empty body', args: { body: '', visibility: 'public' }, field: /body|empty/i },
  { what: 'a whitespace-only body', args: { body: '  \n\t ', visibility: 'public' }, field: /body|empty/i },
];

// resolve —— "$hiring" in a table row stands for the hiring role id (known only after setup).
function resolve(args: Record<string, unknown>): Record<string, unknown> {
  const ids: unknown = args['visible_role_ids'];
  if (!Array.isArray(ids)) return args;
  return { ...args, visible_role_ids: ids.map((i: unknown) => (i === '$hiring' ? o.roles.hiring : i)) };
}

test('create refuses each bad input with a readable message and writes nothing', async () => {
  await createPost(o, { body: `a valid one ${marker('VAL')}`, visibility: 'public' });
  const before = (await listAllPosts(o)).length;
  expect(before, 'the owner list answers (presence)').toBe(1);
  for (const r of CREATE_REFUSALS) {
    const out = await createPostOutcome(o, resolve(r.args));
    expect(out.isError || out.rpcError !== '', `${r.what}: refused`).toBe(true);
    expectReadable(out.text || out.rpcError, r.field, r.what);
  }
  expect((await listAllPosts(o)).length, 'nothing was written').toBe(before);
});

test('update refuses the same inputs, and refuses moving created_at; the post is unchanged', async () => {
  const p = await createPost(o, { body: `kept as is ${marker('UPD')}`, visibility: 'public' });
  const refusals = [
    ...CREATE_REFUSALS.filter((r) => r.what !== 'an empty body' && r.what !== 'a whitespace-only body'),
    { what: 'an empty body', args: { body: '' }, field: /body|empty/i },
    { what: 'setting created_at', args: { created_at: '2020-01-01T00:00:00Z' }, field: /created_at/i },
  ];
  for (const r of refusals) {
    const out = await updatePostOutcome(o, p.id, resolve(r.args));
    expect(out.isError || out.rpcError !== '', `${r.what}: refused`).toBe(true);
    expectReadable(out.text || out.rpcError, r.field, r.what);
  }
  const now = await getPost(o, p.id);
  expect(now.body, 'body unchanged').toBe(p.body);
  expect(now.visibility, 'visibility unchanged').toBe('public');
  expect(now.created_at, 'post time unchanged').toBe(p.created_at);
  expect(now.updated_at, 'no write happened').toBe(p.updated_at);
});

test('an omitted visibility is private: the owner sees "private", an anonymous reader nothing', async () => {
  const m = marker('DEFAULT');
  const pub = await createPost(o, { body: `public sentinel ${marker('DEFPUB')}`, visibility: 'public' });
  const p = await createPost(o, { body: `no visibility given ${m}` });
  expect((await getPost(o, p.id)).visibility, 'the owner reads it back as private').toBe('private');
  const anon = (await timelineText(o.request)).text;
  expect(has(anon, pub.body), 'the anonymous timeline answers (presence)').toBe(true);
  expect(has(anon, m), 'and does not hold the default post').toBe(false);
});

// The owner's AI learns the verbs from tools/list alone: if the schema does not declare post's
// fields, a client sends only what is declared and every post it writes is a private one.
test('the owner MCP declares genre "post" and its fields on the corpus verbs', async () => {
  const tools = await listTools(o.request, o.apiToken, o.sid);
  const tool = (name: string) => tools.find((t) => t.name === name || t.name === name.replace('.', '_'));
  for (const name of ['corpus.create', 'corpus.update']) {
    const props = tool(name)?.inputSchema?.properties ?? {};
    expect(Object.keys(props), `${name} declares the audience fields`).toEqual(
      expect.arrayContaining(['visibility', 'visible_role_ids']));
    expect(JSON.stringify(props['genre']), `${name} names the post genre`).toMatch(/post/);
  }
  for (const name of ['corpus.list', 'corpus.get', 'corpus.search', 'corpus.delete']) {
    expect(JSON.stringify(tool(name)?.inputSchema?.properties?.['genre']), `${name} names the post genre`)
      .toMatch(/post/);
  }
});
