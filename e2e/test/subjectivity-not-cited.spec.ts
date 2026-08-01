// subjectivity-not-cited.spec.ts —— subjectivity is a private visibility tier.
//
// Premise (owner): subjectivity is the owner's private self-model. wiki/output/writing are READ then
// CITED (visitor sees the source); subjectivity GROUNDS the agent's voice but is NOT cited by default —
// a distinct tier between raw (never retrieved) and the public genres. Owner opts a note in via
// show_as_source=true.
//
// Mock note: the dev llm-gateway does corpus_search(user message) → corpus_read(FIRST hit) → reply. So
// each case seeds a note on its OWN distinct topic and asks a question worded to match that note, so it
// ranks first + gets read. The role grants subjectivity:// (owner-gated genre) so the agent can
// retrieve it at all. Questions are distinctive keyword phrases (not filler-heavy natural sentences):
// Meili lexical search mis-ranks "when do you consider …" but nails "shipping standard for backend
// services" — retrieval quality for conversational queries is a separate concern (pgvector, later); here
// we only need each question to deterministically fetch its own note.
//
// Structure: ONE shared owner (beforeAll reset+claim+role+code), notes accumulate across cases keyed by
// topic — mirrors writings.spec.ts. A per-test reset+claim+MCP-init is too heavy for the 30s budget on a
// slow box (the backend serves every call in ~40s wall-clock), so we set up once and bump the timeout.
//
// Coverage: default-not-cited · leak-guard · opt-in-cited(+resolves) · state-toggle · wiki-regression.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { createRole } from '@/fixtures/roles';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'subjcite@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'subjcite',
  fullName: 'Subj Cite Owner',
};
const CODE = 'INTRO-SUBJ';

interface RefView { id: string; path: string; title?: string; body?: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_subjectivity_ids?: string[]; cited_wiki_ids?: string[] }>;
  subjectivity_refs?: RefView[];
  wiki_refs?: RefView[];
}

// Shared across the describe block — set once in beforeAll.
let request: APIRequestContext;
let csrf = '';
let token = '';
let sid = '';

async function transcript(convID: string): Promise<TranscriptResp> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${convID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch: ${res.status()}`);
  return await res.json() as TranscriptResp;
}

function cited(t: TranscriptResp, kind: 'subjectivity' | 'wiki'): Set<string> {
  const refs = kind === 'subjectivity' ? t.subjectivity_refs : t.wiki_refs;
  const refIDs = new Set((refs ?? []).map((r) => r.id));
  const out = new Set<string>();
  for (const m of t.messages) {
    const ids = kind === 'subjectivity' ? m.cited_subjectivity_ids : m.cited_wiki_ids;
    for (const id of ids ?? []) if (refIDs.has(id)) out.add(id);
  }
  return out;
}

// writeSubj —— create (id omitted) or update (id passed, e.g. to toggle show_as_source on the same note).
// Returns the note id + its derived path (subjectivity_write returns both); the path drives the
// corpus_read registration so the agent actually retrieves this note on the turn.
async function writeSubj(
  title: string, body: string, showAsSource?: boolean, id?: string,
): Promise<{ id: string; path: string }> {
  const args: Record<string, unknown> = { title, body, tags: [] };
  if (showAsSource !== undefined) args['show_as_source'] = showAsSource;
  if (id !== undefined) args['subjectivity_id'] = id;
  const r = await callTool<{ subjectivity_id: string; path: string }>(request, token, sid, 'subjectivity_write', args);
  return { id: r.subjectivity_id, path: r.path };
}

// askAndTranscript —— visitor asks `question` (+ the scripted-read tag), we wait for the turn, then
// read the newest conversation. The tag registers the corpus_read the mock (pure registration) emits.
async function askAndTranscript(question: string, tag = ''): Promise<TranscriptResp> {
  const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
  const stream = await sendMessage(request, sess, question + tag);
  await stream.body();
  const res = await request.get(`${BACKEND}/api/admin/conversations`, { headers: { 'X-Csrftoken': csrf } });
  const rows = await res.json() as Array<{ id: string }>;
  const head = rows[0];
  if (!head) throw new Error('no conversations');
  return await transcript(head.id);
}

test.describe('subjectivity is a private visibility tier — grounded but not cited by default', () => {
  // One shared owner + a role granting BOTH subjectivity + wiki retrieval, bound to one code. Set up
  // once; distinct-topic notes accumulate per case. Wall-clock per case ~40s on a slow box, so lift the
  // per-test budget above the 30s default.
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async ({ playwright }) => {
    request = await playwright.request.newContext();
    resetInstance();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    token = await createAPIToken(request, csrf, 'owner');
    sid = await initMCP(request, token);
    const role = await createRole(request, csrf, {
      name: 'subj-grounded', description: 'grants subjectivity + wiki retrieval',
      corpus_uris: ['subjectivity://**', 'wiki://**'],
    });
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'subj cite', assumed_role_id: role.id,
    });
  });

  test.afterAll(async () => { await request.dispose(); });

  test('default: agent reads a subjectivity note but it is NOT cited to the visitor', async () => {
    const { id: subjID, path } = await writeSubj('Shipping standard for backend services',
      'I ship a backend service only once it survives real production load — SUBJPRIVATEKEY.');
    const tag = await scriptMockToolCall(request, { name: 'corpus_read', args: { path } });
    const t = await askAndTranscript('shipping standard for backend services', tag);
    expect(cited(t, 'subjectivity').has(subjID), 'default subjectivity note is NOT cited').toBe(false);
  });

  test('leak guard: a private subjectivity note body is never surfaced to the visitor as a source', async () => {
    const { path } = await writeSubj('Handling code review disagreement',
      'my private standpoint on code review disagreement — SUBJLEAKKEY must never be a cited source.');
    const tag = await scriptMockToolCall(request, { name: 'corpus_read', args: { path } });
    const t = await askAndTranscript('handling code review disagreement', tag);
    const surfaced = JSON.stringify(t.subjectivity_refs ?? []) + JSON.stringify(t.wiki_refs ?? []);
    expect(surfaced.includes('SUBJLEAKKEY'), 'private subjectivity body must not appear in any cited ref').toBe(false);
  });

  test('opt-in: a show_as_source subjectivity note IS cited and its ref resolves', async () => {
    const { id: subjID, path } = await writeSubj('Good API design principle',
      'a good API design is one you can guess without the docs — SUBJPUBLICKEY.', true);
    const tag = await scriptMockToolCall(request, { name: 'corpus_read', args: { path } });
    const t = await askAndTranscript('good API design principle', tag);
    expect(cited(t, 'subjectivity').has(subjID), 'opted-in subjectivity note IS cited').toBe(true);
    const ref = (t.subjectivity_refs ?? []).find((r) => r.id === subjID);
    expect(ref?.title, 'the cited subjectivity ref resolves (title present)')
      .toBe('Good API design principle');
  });

  test('state toggle: flipping show_as_source false→true makes a note become cited', async () => {
    const { id: subjID, path } = await writeSubj('Rewrite versus refactor call',
      'my take on the rewrite versus refactor call — SUBJTOGGLEKEY.');
    const tagBefore = await scriptMockToolCall(request, { name: 'corpus_read', args: { path } });
    const before = await askAndTranscript('rewrite versus refactor call', tagBefore);
    expect(cited(before, 'subjectivity').has(subjID), 'private before toggle').toBe(false);

    // Toggle via UPDATE (pass the id) — not a second create, which would collide on the slug.
    await writeSubj('Rewrite versus refactor call',
      'my take on the rewrite versus refactor call — SUBJTOGGLEKEY.', true, subjID);
    const tagAfter = await scriptMockToolCall(request, { name: 'corpus_read', args: { path } });
    const after = await askAndTranscript('rewrite versus refactor call', tagAfter);
    expect(cited(after, 'subjectivity').has(subjID), 'cited after owner opts in').toBe(true);
  });

  test('regression: a wiki note is still read and cited (subjectivity change did not break wiki)', async () => {
    const raw = await callTool<{ id: string }>(request, token, sid, 'corpus.create',
      { genre: 'raw',
        body: 'At FlowPay I built a payment reconciliation pipeline over Kafka — WIKIMARKER.',
        source: 'mcp', tags: [] });
    const wiki = await callTool<{ id: string; path: string }>(request, token, sid, 'corpus.promote',
      { genre: 'raw', id: raw.id, title: 'Payment reconciliation pipeline', tags: [] });
    const tag = await scriptMockToolCall(request, { name: 'corpus_read', args: { path: wiki.path } });
    const t = await askAndTranscript('payment reconciliation pipeline', tag);
    expect(cited(t, 'wiki').size, 'wiki is still cited (regression)').toBeGreaterThan(0);
  });
});
