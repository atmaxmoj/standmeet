// subjectivity-not-cited.spec.ts —— target-state RED (corpus visibility tiers).
//
// Premise (owner): subjectivity is the owner's private self-model. Unlike wiki/output/writing —
// which the agent READS then CITES (the visitor sees the source) — subjectivity GROUNDS the agent's
// voice/judgment but is NOT shown to the visitor by default. A distinct tier:
//   raw          — agent never retrieves, never shown (private inbox).
//   subjectivity — agent retrieves to ground its voice, NOT cited by default …
//                  … UNLESS the owner opts a note in (show_as_source=true).
//   wiki/output  — agent retrieves AND cites (public knowledge).
//
// Mechanism: reuse the existing `show_as_source` flag ("AI reads it, not counted in the cited footer"),
// but subjectivity DEFAULTS to false (private); the citation path resolves subjectivity via a new
// cited_subjectivity_ids / subjectivity_refs channel, gated on show_as_source=true.
//
// Coverage (feature floor): default-private · opt-in-cited(+resolves) · state-toggle · LEAK-guard
// (private body never surfaced) · regression (wiki still cites alongside) · retrieval-unaffected
// (agent can still read a private subjectivity note to ground).
//
// RED today: subjectivity isn't in the citation resolution path, subjectivity_write has no
// show_as_source, and the transcript exposes no subjectivity_refs.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { issueSession, sendMessage } from '@/fixtures/visitor';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const OWNER = {
  email: 'subjcite@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'subjcite',
  fullName: 'Subj Cite Owner',
};
const CODE = 'INTRO-SUBJ';
const SHIP_Q = 'when do you consider software good enough to ship?';

interface RefView { id: string; path: string; title?: string; body?: string }
interface TranscriptResp {
  messages: Array<{ role: string; body?: string; cited_subjectivity_ids?: string[]; cited_wiki_ids?: string[] }>;
  subjectivity_refs?: RefView[];
  wiki_refs?: RefView[];
}

async function transcript(
  request: APIRequestContext, csrf: string, convID: string,
): Promise<TranscriptResp> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${convID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch: ${res.status()}`);
  return await res.json() as TranscriptResp;
}

// citedSubjIDs —— subjectivity ids the visitor's transcript actually surfaces as cited (both the
// per-message id list AND a resolved ref must be present).
function citedSubjIDs(t: TranscriptResp): Set<string> {
  const refIDs = new Set((t.subjectivity_refs ?? []).map((r) => r.id));
  const out = new Set<string>();
  for (const m of t.messages) {
    for (const id of m.cited_subjectivity_ids ?? []) if (refIDs.has(id)) out.add(id);
  }
  return out;
}

function citedWikiIDs(t: TranscriptResp): Set<string> {
  const refIDs = new Set((t.wiki_refs ?? []).map((r) => r.id));
  const out = new Set<string>();
  for (const m of t.messages) {
    for (const id of m.cited_wiki_ids ?? []) if (refIDs.has(id)) out.add(id);
  }
  return out;
}

async function ownerMCP(request: APIRequestContext): Promise<{ csrf: string; token: string; sid: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'owner');
  const sid = await initMCP(request, token);
  return { csrf, token, sid };
}

async function writeSubj(
  request: APIRequestContext, token: string, sid: string, title: string, body: string, showAsSource?: boolean,
): Promise<string> {
  const args: Record<string, unknown> = { title, body, tags: [] };
  if (showAsSource !== undefined) args['show_as_source'] = showAsSource;
  const r = await callTool<{ subjectivity_id: string }>(request, token, sid, 'subjectivity_write', args);
  return r.subjectivity_id;
}

async function askAsVisitor(request: APIRequestContext, question: string): Promise<void> {
  const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
  const stream = await sendMessage(request, sess, question);
  await stream.body();
}

async function latestConv(request: APIRequestContext, csrf: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/admin/conversations`, { headers: { 'X-Csrftoken': csrf } });
  const rows = await res.json() as Array<{ id: string }>;
  const head = rows[0];
  if (!head) throw new Error('no conversations');
  return head.id;
}

test.describe('subjectivity is a private visibility tier — grounded but not cited by default', () => {
  test.beforeEach(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password, handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { token, sid } = await ownerMCP(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, { code: CODE, label: 'intro', purpose: 'subj cite' });
    // one wiki note as the public control (agent should cite this).
    const raw = await callTool<{ raw_id: string }>(request, token, sid, 'raw_dump',
      { body: 'At FlowPay I built a reconciliation pipeline — WIKIMARKER.', source: 'mcp', tags: [] });
    await callTool(request, token, sid, 'promote_to_wiki', { raw_id: raw.raw_id, title: 'Reconciliation', tags: [] });
    await request.dispose();
  });

  test('default: subjectivity grounds the voice but is NOT cited (+ wiki IS cited alongside)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf, token, sid } = await ownerMCP(request);
    const subjID = await writeSubj(request, token, sid, 'The outage',
      'A 2am outage taught me I do not trust code I have not seen survive load — SUBJPRIVATEKEY.');

    await askAsVisitor(request, SHIP_Q);
    const t = await transcript(request, csrf, await latestConv(request, csrf));

    expect(citedSubjIDs(t).has(subjID), 'default subjectivity note is NOT cited').toBe(false);
    expect(citedWikiIDs(t).size, 'wiki is still cited alongside (regression)').toBeGreaterThan(0);
    await request.dispose();
  });

  test('leak guard: a private subjectivity note body is never surfaced to the visitor as a source', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf, token, sid } = await ownerMCP(request);
    await writeSubj(request, token, sid, 'The outage', 'private standpoint — SUBJLEAKKEY should never appear as a cited source.');

    await askAsVisitor(request, SHIP_Q);
    const t = await transcript(request, csrf, await latestConv(request, csrf));
    const surfaced = JSON.stringify(t.subjectivity_refs ?? []) + JSON.stringify(t.wiki_refs ?? []);
    expect(surfaced.includes('SUBJLEAKKEY'), 'private subjectivity body must not appear in any cited ref').toBe(false);
    await request.dispose();
  });

  test('opt-in: a show_as_source subjectivity note IS cited and its ref resolves', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf, token, sid } = await ownerMCP(request);
    const subjID = await writeSubj(request, token, sid, 'Why I ship rough',
      'Withholding a working thing to satisfy my taste is vanity — SUBJPUBLICKEY.', true);

    await askAsVisitor(request, SHIP_Q);
    const t = await transcript(request, csrf, await latestConv(request, csrf));

    expect(citedSubjIDs(t).has(subjID), 'opted-in subjectivity note IS cited').toBe(true);
    const ref = (t.subjectivity_refs ?? []).find((r) => r.id === subjID);
    expect(ref?.title, 'the cited subjectivity ref resolves (title present)').toBe('Why I ship rough');
    await request.dispose();
  });

  test('state toggle: flipping show_as_source false→true makes a note become cited', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf, token, sid } = await ownerMCP(request);
    // create private (default), confirm not cited.
    const subjID = await writeSubj(request, token, sid, 'Toggle note', 'toggle body — SUBJTOGGLEKEY.');
    await askAsVisitor(request, SHIP_Q);
    const before = await transcript(request, csrf, await latestConv(request, csrf));
    expect(citedSubjIDs(before).has(subjID), 'private before toggle').toBe(false);

    // owner opts it in (same title → update), ask again → now cited.
    await writeSubj(request, token, sid, 'Toggle note', 'toggle body — SUBJTOGGLEKEY.', true);
    await askAsVisitor(request, SHIP_Q);
    const after = await transcript(request, csrf, await latestConv(request, csrf));
    expect(citedSubjIDs(after).has(subjID), 'cited after owner opts in').toBe(true);
    await request.dispose();
  });
});
