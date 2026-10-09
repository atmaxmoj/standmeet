// posts-no-side-channel.spec.ts —— posts-tests.md § B: the places post text leaves the instance
// without a reader asking for it. Each row checks a marker is absent AND, in the same run, that the
// channel actually carried something (its presence check) — an absence on a channel that never
// fired proves nothing.
//
// Contract fixed here, beyond posts.md:
//   • post.created / post.updated / post.deleted are webhook-exposed event types (a webhook endpoint
//     and a notify rule may watch them); data is {post_id, visibility}; the subject names the post id.
//   • A visible post read in a turn is cited like a writing: the citation frame carries its excerpt.
//   • `<Posts />` from @standmeet/sdk loads in the reader's browser: a microsite's built HTML holds
//     no post (a build would freeze a copy that outlives a post going private).
//   • Posts are not indexed at all (posts.md): the index is read whole (every document of every
//     Meili index) and carries no post marker, while a note written after them is there.
// Notify cards render one way for every channel (subscriber/notify.go renderCard), so the email
// channel stands for the IM one; the turn-diagnostics view is owner-only and not a visitor egress.

import { test, expect } from '@/fixtures/test';
import { createCode } from '@/fixtures/codes';
import { callTool } from '@/fixtures/mcp';
import { clearMailpit, configureMailSupplier, waitForMailToContaining } from '@/fixtures/mail';
import { publishPage } from '@/fixtures/microsite-rig';
import {
  gatewayRequestExists, scriptMockReplyText, scriptMockToolCall,
} from '@/fixtures/mock-llm-script';
import { inspectPDF } from '@/fixtures/pdf-inspect';
import {
  createPost, deletePost, has, marker, seedMatrix, setupPostsOwner, turnRaw, updatePost,
  type PostsOwner, type PostView, type Seeded,
} from '@/fixtures/posts';
import {
  imVisitorAsks, liveTokenIn, meiliText, modelSaw, notifyByMail, POSTS_PAGE, readsTurn, reportIDIn,
} from '@/fixtures/posts-sidechannel';
import { createRole } from '@/fixtures/roles';
import { APP_BASE, BACKEND } from '@/fixtures/stack';
import { connectTelegram, resetTelegram } from '@/fixtures/telegram';
import { issueByoaiSession, issueSession, sendMessage } from '@/fixtures/visitor';
import { awaitSink, createHook, resetSink, type SinkDelivery } from '@/fixtures/webhooks';

const HANDLE = 'postsside';
const PASSWORD = 'correct-horse-battery-staple'; // setupPostsOwner's owner password
const SINK = 'posts-side';
const POST_TYPES = ['post.created', 'post.updated', 'post.deleted'];
const CARD = 'POSTCARD';
const LIVE_CARD = 'LIVECARD';
const BOT_TOKEN = '7000002:POSTS-SIDE-abcdefghijklmnopqrstuvwxyz0123';
const IM_CHAT = 5151;
const REPORT_HTML = '<h1>Recap</h1><p>The visitor asked what is new.</p>';

let o: PostsOwner;
let s: Seeded;
// extra: a public post created, edited and deleted, so every post.* event type fires once.
let extra: PostView;
const X = { fact: marker('FACT'), factPost: marker('FACTPOST'), extra: marker('EXTRA'), extra2: marker('EXTRAB') };
let factsCode = '';
let factPostID = '';

// every marker this spec ever wrote into a post body (the fact note's marker is not a post).
function postMarks(): string[] {
  return [...Object.values(s.m), X.factPost, X.extra, X.extra2];
}

function expectNone(text: string, marks: string[], what: string): void {
  for (const m of marks) expect(has(text, m), `${what} must not carry ${m}`).toBe(false);
}

test.describe.configure({ mode: 'serial', timeout: 600_000 });

test.beforeAll(async ({ playwright }) => {
  o = await setupPostsOwner(playwright, HANDLE);
  const r = o.request;
  await resetSink(r);
  await resetTelegram(r);
  await clearMailpit(r);
  // Watchers first, so the posts' own events reach them.
  await createHook(o, SINK, POST_TYPES);
  const mailCtx = await playwright.request.newContext();
  await configureMailSupplier(mailCtx, `${HANDLE}@example.com`, PASSWORD);
  await mailCtx.dispose();
  await notifyByMail(o, 'post.*', CARD);
  await notifyByMail(o, 'conversation.started', LIVE_CARD);
  await seedFactsRole();
  s = await seedMatrix(o);
  extra = await createPost(o, { body: `Soon gone ${X.extra}.`, visibility: 'public' });
  await updatePost(o, extra.id, { body: `Edited ${X.extra2}.` });
  await deletePost(o, extra.id);
});

test.afterAll(async () => { await o.request.dispose(); });

// seedFactsRole —— a role naming one fact note (which goes into every turn's instruction) and a
// roles post addressed to it (which must not).
async function seedFactsRole(): Promise<void> {
  await callTool(o.request, o.apiToken, o.sid, 'subjectivity_write',
    { title: 'background', body: `Where I work from: ${X.fact}.` });
  const role = await createRole(o.request, o.csrf, {
    name: 'facts', description: 'names its fact note', corpus_uris: ['subjectivity://background'],
  });
  factsCode = `${HANDLE.toUpperCase()}-FACTS`;
  await createCode(o.request, o.csrf, { code: factsCode, label: 'facts', assumed_role_id: role.id });
  factPostID = (await createPost(o, {
    body: `For the facts role ${X.factPost}.`, visibility: 'roles', visible_role_ids: [role.id],
  })).id;
}

test('Meili: no post of any audience is in the index — posts are searched through their audience', async () => {
  // Presence: a wiki note written after every post reaches the index, so the index is live and has
  // handled every earlier write.
  const sent = marker('SENT');
  await callTool(o.request, o.apiToken, o.sid, 'corpus.create',
    { genre: 'wiki', title: `Sentinel ${sent}`, body: `Sentinel note ${sent}.` });
  let text = '';
  await expect.poll(() => {
    text = meiliText();
    return has(text, sent);
  }, { timeout: 60_000, intervals: [1_000], message: 'the sentinel note reaches the index' }).toBe(true);
  expectNone(text, postMarks(), 'the search index');
});

test('public-tier chat on the home page: the public post is cited, nothing narrower is read', async () => {
  const r = o.request;
  const sess = await issueSession(r, { handle: o.handle, mode: 'public', visitor_name: 'pub' });
  const tag = await readsTurn(r, [s.priv.id, s.pub.id, s.hir.id, s.hirInv.id]);
  const turn = await turnRaw(r, sess, `what has he been up to?${tag}`);
  expect(turn.status).toBe(200);
  expect(has(turn.text, s.m.pub), 'presence: the public post is in the stream').toBe(true);
  // The citation is the read's tool_completed frame: genre post, its id, time and text.
  expect(turn.text, 'presence: it is cited')
    .toMatch(new RegExp(`\\\\"genre\\\\":\\\\"post\\\\",\\\\"id\\\\":\\\\"${s.pub.id}`));
  expectNone(turn.text, [s.m.priv, s.m.hir, s.m.hirInv], 'the public-tier stream');
  expect(await modelSaw(r, tag, { pub: s.m.pub, priv: s.m.priv, hir: s.m.hir, hirInv: s.m.hirInv }),
    'the model got the public post and nothing narrower')
    .toEqual({ pub: true, priv: false, hir: false, hirInv: false });
});

test('the instruction carries no post; the role\'s named fact note is there', async () => {
  const r = o.request;
  // An earlier conversation on the same code read the facts post: a cross-conversation digest
  // would be the way it travels into the next one.
  const first = await issueSession(r, { handle: o.handle, code: factsCode, visitor_name: 'f1' });
  const read = await turnRaw(r, first, `anything for me?${await readsTurn(r, [factPostID])}`);
  expect(has(read.text, X.factPost), 'presence: the facts role may read its post').toBe(true);

  const next = await issueSession(r, { handle: o.handle, code: factsCode, visitor_name: 'f2' });
  const tag = await scriptMockReplyText(r, 'noted.');
  const turn = await turnRaw(r, next, `what's new? ${tag}`);
  // The mock gateway echoes the instruction it received into the reply ([system:...]).
  expect(has(turn.text, X.fact), 'presence: the named fact note is in the instruction').toBe(true);
  expectNone(turn.text, postMarks(), 'the echoed instruction');
  const saw = await modelSaw(r, tag, Object.fromEntries(postMarks().map((m) => [m, m])));
  expect(Object.values(saw).some(Boolean), 'no post reached the model without a tool call').toBe(false);
});

test('BYOAI: the visitor-chosen endpoint receives the public post and nothing narrower', async () => {
  const r = o.request;
  const byo = await issueByoaiSession(r, {
    handle: o.handle, byoai_provider: 'anthropic', byoai_key: 'sk-visitor-side',
    byoai_endpoint: 'http://llm-gateway:9300', byoai_model: 'claude-sonnet-4-6', visitor_name: 'byo',
  });
  const tag = await readsTurn(r, [s.priv.id, s.pub.id, s.hir.id, s.hirInv.id]);
  expect((await sendMessage(r, byo, `what is new?${tag}`)).status()).toBe(200);
  expect(await modelSaw(r, tag, { pub: s.m.pub, priv: s.m.priv, hir: s.m.hir, hirInv: s.m.hirInv }),
    'the endpoint the visitor chose got the public post only')
    .toEqual({ pub: true, priv: false, hir: false, hirInv: false });
});

test('report, its PDF and the live replay hold what the conversation read, never the private post', async () => {
  const r = o.request;
  const sess = await issueSession(r, { handle: o.handle, code: o.codes.hiring, visitor_name: 'rep' });
  const read = await turnRaw(r, sess, `what is new?${await readsTurn(r, [s.priv.id, s.hir.id])}`);
  expect(has(read.text, s.m.hir), 'presence: this conversation read the hiring post').toBe(true);
  const sum = `${await scriptMockToolCall(r, { name: 'summarize_conversation', args: {} })}${await scriptMockReplyText(r, REPORT_HTML)}`;
  const reportID = reportIDIn((await turnRaw(r, sess, `recap please${sum}`)).text);
  expect(reportID, 'the summarize turn produced a report').toBeTruthy();
  const auth = { headers: { Authorization: `Bearer ${sess.session_token}` } };
  const report = await r.get(`${BACKEND}/api/v1/report/${reportID}`, auth);
  expect(report.status()).toBe(200);
  expectNone(await report.text(), [s.m.priv], 'the report');
  const pdf = await r.get(`${BACKEND}/api/v1/report/${reportID}/pdf`, auth);
  const pdfText = (await inspectPDF(await pdf.body())).text;
  expect(pdfText, 'presence: the PDF has the report text').toContain('Recap');
  expectNone(pdfText, [s.m.priv], 'the report PDF');

  const mail = await waitForMailToContaining(r, `${HANDLE}@example.com`, sess.conversation_id, 60_000);
  const live = await r.get(`${BACKEND}/api/v1/live/${liveTokenIn(mail.text)}`);
  expect(live.status(), 'the card\'s live link opens').toBe(200);
  const liveText = await live.text();
  expect(has(liveText, s.m.hir), 'presence: the replay carries the cited hiring post').toBe(true);
  expectNone(liveText, [s.m.priv], 'the live replay');
});

test('webhooks, notify mail and events.list name each post and its visibility, never a body', async () => {
  const all = [s.priv, s.pub, s.hir, s.hirInv];
  const got = await awaitSink(o.request, SINK, (ds) => all.every((p) => created(ds, p.id))
    && ds.some((d) => d.body.type === 'post.deleted' && d.body.data['post_id'] === extra.id), 90_000);
  for (const p of all) {
    expect(created(got, p.id)?.body.data, `presence: post.created for the ${p.visibility} post`)
      .toEqual({ post_id: p.id, visibility: p.visibility });
  }
  expect(got.some((d) => d.body.type === 'post.updated' && d.body.data['post_id'] === extra.id),
    'presence: post.updated fired').toBe(true);
  expectNone(got.map((d) => d.raw).join('\n'), postMarks(), 'the webhook deliveries');

  for (const p of [...all, extra]) {
    const m = await waitForMailToContaining(o.request, `${HANDLE}@example.com`, p.id, 60_000);
    expect(m.text, 'presence: the card came from the post rule').toContain(CARD);
    expectNone(`${m.subject}\n${m.text}`, postMarks(), `the notify mail for ${p.id}`);
  }

  const evs = JSON.stringify(await callTool(o.request, o.apiToken, o.sid, 'events.list', { type: 'post.*', limit: 200 }));
  for (const p of [...all, extra]) expect(evs, `presence: events.list names ${p.id}`).toContain(p.id);
  expectNone(evs, postMarks(), 'events.list');
});

// The prerendered HTML carries no post at all: the timeline loads in the reader's browser as that
// reader, so a page built before a post went private can never serve it (posts.md). What a reader
// then sees is posts-in-microsite.spec's.
test('microsite prerender, OG and sitemap: no post', async () => {
  await publishPage(o.request, o.csrf, 'updates', POSTS_PAGE, 300_000);
  const html = await (await o.request.get(`${APP_BASE}/p/updates`)).text();
  expect(html, 'presence: the prerender carries the page\'s own text').toContain('Updates');
  expectNone(html, postMarks(), 'the prerendered HTML + OG');

  const sitemap = await (await o.request.get(`${APP_BASE}/sitemap.xml`)).text();
  expect(sitemap, 'presence: the sitemap lists the owner\'s pages').toContain('<loc>');
  expectNone(sitemap, [...postMarks(), s.priv.id, s.pub.id, s.hir.id, s.hirInv.id], 'the sitemap');
});

test('IM bridge on a hiring code: the private post never reaches the chat', async () => {
  test.setTimeout(300_000);
  const r = o.request;
  expect(await connectTelegram(r, o.csrf, BOT_TOKEN), 'telegram connected').toBe(200);
  const tag = await readsTurn(r, [s.priv.id, s.hir.id]);
  const sent = await imVisitorAsks(r, IM_CHAT, o.codes.hiring, `what is new?${tag}`);
  expectNone(sent.map((m) => m.text).join('\n'), [s.m.priv], 'the Telegram chat');
  // What the chat gets is the model's answer; the model's input is where the read lands.
  expect(await modelSaw(r, tag, { hir: s.m.hir, priv: s.m.priv }),
    'the turn behind the chat read the hiring post and not the private one')
    .toEqual({ hir: true, priv: false });
});

test('across every row above, no model request ever carried the private post', async () => {
  expect(await gatewayRequestExists(o.request, s.m.pub), 'presence: the public post did reach the model').toBe(true);
  expect(await gatewayRequestExists(o.request, s.m.priv), 'the private post never did').toBe(false);
});

function created(ds: SinkDelivery[], id: string): SinkDelivery | undefined {
  return ds.find((d) => d.body.type === 'post.created' && d.body.data['post_id'] === id);
}
