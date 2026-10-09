// posts-visibility.spec.ts —— posts-tests.md § A, the visibility matrix: who sees which post,
// through every read path they can reach.
//
// Four posts, one marker each: private / public / roles=[hiring] / roles=[hiring, invited]. Every
// reader row is checked through every path it can reach, and each ✓ cell is the positive control
// of the ✗ cells in its row: the same reader reaching the public marker through the same path
// proves the path works, so an absent marker means "refused", not "the path never ran".
//
// Rows not written twice: an embed `<standmeet-chat>` issues the same code session its code does
// (embed-token-auth.spec proves the server resolves the JWT to the code), and the SDK BlockWidget's
// public session is the public-tier session below — both read through the rows that stand for them.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { callTool } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import {
  has, listAllPosts, seedMatrix, setupPostsOwner, timelineText, turnRaw, visitorToolRaw,
  type PostsOwner, type Seeded,
} from '@/fixtures/posts';
import { issueByoaiSession, issueSession, type VisitorSession } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

type Cell = 'priv' | 'pub' | 'hir' | 'hirInv';
const CELLS: Cell[] = ['priv', 'pub', 'hir', 'hirInv'];

// The expected row of each session reader (✓ = must see).
const SEES: Record<string, Cell[]> = {
  anonymous: ['pub'],
  public: ['pub'],
  byoai: ['pub'],
  hiring: ['pub', 'hir', 'hirInv'],
  invited: ['pub', 'hirInv'],
  wide: ['pub'],
  hiringDenyAll: ['pub', 'hir', 'hirInv'],
};

let o: PostsOwner;
let s: Seeded;
let sessions: Record<string, VisitorSession>;

function postOf(c: Cell): { id: string; mark: string } {
  return { id: s[c].id, mark: s.m[c] };
}

// expectRow —— one reader through one path: exactly its ✓ markers, none of its ✗ markers.
function expectRow(text: string, sees: Cell[], what: string): void {
  for (const c of CELLS) {
    expect(has(text, s.m[c]), `${what}: ${sees.includes(c) ? 'must see' : 'must NOT see'} the ${c} post`)
      .toBe(sees.includes(c));
  }
}

test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test.beforeAll(async ({ playwright }) => {
    o = await setupPostsOwner(playwright, 'postsvis');
    s = await seedMatrix(o);
    const r = o.request;
    sessions = {
      public: await issueSession(r, { handle: o.handle, mode: 'public', visitor_name: 'pub' }),
      byoai: await issueByoaiSession(r, {
        handle: o.handle, byoai_provider: 'anthropic', byoai_key: 'sk-visitor',
        byoai_endpoint: 'http://llm-gateway:9300', byoai_model: 'claude-sonnet-4-6', visitor_name: 'byo',
      }),
      hiring: await issueSession(r, { handle: o.handle, code: o.codes.hiring, visitor_name: 'h' }),
      invited: await issueSession(r, { handle: o.handle, code: o.codes.invited, visitor_name: 'i' }),
      wide: await issueSession(r, { handle: o.handle, code: o.codes.wide, visitor_name: 'w' }),
      hiringDenyAll: await issueSession(r, { handle: o.handle, code: o.codes.hiringDenyAll, visitor_name: 'd' }),
    };
  });

  test.afterAll(async () => { await o.request.dispose(); });

  test('owner: admin list and owner MCP see all four', async () => {
    const all = JSON.stringify(await listAllPosts(o));
    expectRow(all, CELLS, 'owner MCP corpus.list');
    const admin = await o.request.get(`${BACKEND}/api/admin/corpus/post?limit=200`,
      { headers: { 'X-Csrftoken': o.csrf } });
    expectRow(await admin.text(), CELLS, 'admin /api/admin/corpus/post');
  });

  test('path 1 — the timeline API', async () => {
    const anon = await timelineText(o.request);
    expect(anon.status).toBe(200);
    expectRow(anon.text, SEES['anonymous']!, 'anonymous timeline');
    for (const who of Object.keys(sessions)) {
      const t = await timelineText(o.request, sessions[who]!.session_token);
      expectRow(t.text, SEES[who]!, `${who} timeline`);
    }
  });

  test('path 3 — the direct tool route: corpus_search and corpus_list', async () => {
    for (const who of Object.keys(sessions)) {
      let text = '';
      for (const c of CELLS) {
        text += (await visitorToolRaw(o.request, sessions[who]!, 'corpus_search', { query: s.m[c] })).text;
      }
      text += (await visitorToolRaw(o.request, sessions[who]!, 'corpus_list', { path: 'posts' })).text;
      expectRow(text, SEES[who]!, `${who} direct corpus_search/list`);
    }
  });

  test('path 4 — corpus_read by path and by URI; an invisible post answers like a random id', async () => {
    for (const who of Object.keys(sessions)) {
      const sess = sessions[who]!;
      const missing = await visitorToolRaw(o.request, sess, 'corpus_read', { path: `posts/${randomUUID()}` });
      for (const c of CELLS) {
        const { id, mark } = postOf(c);
        for (const path of [`posts/${id}`, `post://${id}`]) {
          const got = await visitorToolRaw(o.request, sess, 'corpus_read', { path });
          if (SEES[who]!.includes(c)) {
            expect(has(got.text, mark), `${who} reads ${c} via ${path}`).toBe(true);
          } else {
            expect(got.status, `${who} ${c} via ${path}: same status as a missing post`).toBe(missing.status);
            expect(noIDs(got.text).replaceAll('post://', 'posts/'), `${who} ${c} via ${path}: same body as a missing post`)
              .toBe(noIDs(missing.text));
          }
        }
      }
    }
  });

  test('path 5 — the nav tools: map, resolve, peek, grep, links', async () => {
    for (const who of Object.keys(sessions)) {
      const sess = sessions[who]!;
      let text = (await visitorToolRaw(o.request, sess, 'corpus_map', {})).text;
      for (const c of CELLS) {
        const { id, mark } = postOf(c);
        text += (await visitorToolRaw(o.request, sess, 'corpus_grep', { pattern: mark, fixed: true })).text;
        text += (await visitorToolRaw(o.request, sess, 'corpus_resolve', { name: mark })).text;
        text += (await visitorToolRaw(o.request, sess, 'corpus_peek', { paths: [`posts/${id}`] })).text;
        text += (await visitorToolRaw(o.request, sess, 'corpus_links', { path: `posts/${id}` })).text;
      }
      expectRow(text, SEES[who]!, `${who} nav tools`);
    }
  });

  test('paths 2 + 6 — an agent turn that reads each post: the stream and its citations', async () => {
    for (const who of ['public', 'hiring', 'invited', 'wide', 'hiringDenyAll']) {
      const sess = sessions[who]!;
      let stream = '';
      for (const c of CELLS) {
        const tag = await scriptMockToolCall(o.request, { name: 'corpus_read', args: { path: `posts/${s[c].id}` } });
        const turn = await turnRaw(o.request, sess, `tell me about that update${tag}`);
        expect(turn.status, `${who} turn on ${c}`).toBe(200);
        stream += turn.text;
        if (SEES[who]!.includes(c)) {
          // The citation is the read's tool_completed frame: genre post, its id, time and text.
          expect(turn.text, `${who}: a read of a visible post yields a citation`)
            .toMatch(new RegExp(`\\\\"genre\\\\":\\\\"post\\\\",\\\\"id\\\\":\\\\"${s[c].id}`));
        }
      }
      // The whole stream — answer, tool_completed frames, citation frames — is one text here.
      expectRow(stream, SEES[who]!, `${who} agent turn stream`);
    }
  });

  test('API-key facade (key on role hiring) and visitor MCP (code on invited)', async ({ playwright }) => {
    const r = await playwright.request.newContext();
    const mint = await callTool<{ secret: string }>(o.request, o.apiToken, o.sid, 'api_keys.create',
      { label: 'posts-facade', assumed_role_id: o.roles.hiring });
    await callTool(o.request, o.apiToken, o.sid, 'api.open', { block_id: 'corpus.retrieval' });
    let facade = '';
    for (const c of CELLS) {
      const res = await r.fetch(`${BACKEND}/api/pub/v1/tools/corpus_search`,
        { method: 'POST', headers: { Authorization: `Bearer ${mint.secret}` }, data: { query: s.m[c] } });
      facade += await res.text();
      const read = await r.fetch(`${BACKEND}/api/pub/v1/tools/corpus_read`,
        { method: 'POST', headers: { Authorization: `Bearer ${mint.secret}` }, data: { path: `posts/${s[c].id}` } });
      facade += await read.text();
    }
    expectRow(facade, SEES['hiring']!, 'API-key facade on hiring');

    expectRow(await visitorMCPReads(r, o.codes.invited), SEES['invited']!, 'visitor MCP on invited');
    await r.dispose();
  });

// noIDs —— a response with every uuid blanked, so two refusals are compared on their wording.
function noIDs(t: string): string {
  return t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
}

// visitorMCPReads —— /mcp/visitor with a code as the bearer: corpus_search + corpus_read per post.
async function visitorMCPReads(r: APIRequestContext, code: string): Promise<string> {
  const MCP = `${BACKEND}/mcp/visitor`;
  const headers = (sid: string): Record<string, string> => ({
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${code}`, 'X-Standmeet-Visitor': 'mcp', ...(sid ? { 'Mcp-Session-Id': sid } : {}),
  });
  const init = await r.post(MCP, { headers: headers(''), data: {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } },
  } });
  const sid = init.headers()['mcp-session-id'] ?? '';
  let text = '';
  let id = 2;
  for (const c of CELLS) {
    for (const [name, args] of [
      ['corpus_search', { query: s.m[c] }], ['corpus_read', { path: `posts/${s[c].id}` }],
    ] as const) {
      const res = await r.post(MCP, { headers: headers(sid), data: {
        jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args },
      } });
      text += await res.text();
    }
  }
  return text;
}
