// subjectivity-not-cited.spec.ts —— target-state RED (#151-adjacent: corpus visibility tiers).
//
// Premise (owner): subjectivity is the owner's private self-model. Unlike wiki/output/writing —
// which the agent READS and then CITES (the visitor sees the source) — subjectivity should GROUND the
// agent's voice/judgment but NOT be shown to the visitor by default. It is a distinct visibility tier:
//   raw          — agent never retrieves, never shown (private inbox).
//   subjectivity — agent retrieves to ground its voice, NOT cited/shown (private standpoint) …
//                  … UNLESS the owner opts a note in (show_as_source=true).
//   wiki/output  — agent retrieves AND cites (public knowledge).
//
// Mechanism: reuse the existing `show_as_source` flag ("AI reads it but not counted in the cited
// footer"), but subjectivity DEFAULTS to false (private), and the citation path resolves subjectivity
// (a new cited_subjectivity_ids / subjectivity_refs channel) only for notes with show_as_source=true.
//
// RED today: subjectivity is not in the citation resolution path at all, subjectivity_write has no
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

interface SubjRefView { id: string; path: string }
interface TranscriptResp {
  messages: Array<{ role: string; cited_subjectivity_ids: string[] }>;
  subjectivity_refs: SubjRefView[];
}

// citedSubjectivityIDs —— which subjectivity ids the visitor's transcript actually surfaces as cited.
async function citedSubjectivityIDs(
  request: APIRequestContext, csrf: string, convID: string,
): Promise<Set<string>> {
  const res = await request.get(`${BACKEND}/api/admin/conversations/${convID}`, {
    headers: { 'X-Csrftoken': csrf },
  });
  if (!res.ok()) throw new Error(`transcript fetch: ${res.status()}`);
  const body = await res.json() as TranscriptResp;
  const ids = new Set<string>();
  for (const m of body.messages) {
    for (const id of m.cited_subjectivity_ids ?? []) ids.add(id);
  }
  // subjectivity_refs must also exist (the resolved, visitor-visible refs).
  const refIDs = new Set((body.subjectivity_refs ?? []).map((r) => r.id));
  return new Set([...ids].filter((id) => refIDs.has(id)));
}

async function firstConvID(request: APIRequestContext, csrf: string): Promise<string> {
  const res = await request.get(`${BACKEND}/api/admin/conversations`, {
    headers: { 'X-Csrftoken': csrf },
  });
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
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await request.dispose();
  });

  test('default: agent grounds in subjectivity but it is NOT cited to the visitor', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const apiToken = await createAPIToken(request, csrf, 'owner');
    const sid = await initMCP(request, apiToken);

    // a subjectivity note, DEFAULT visibility (no show_as_source → private grounding).
    const subj = await callTool<{ subjectivity_id: string }>(request, apiToken, sid,
      'subjectivity_write', {
        title: 'How the outage shaped me',
        body: 'A 2am outage taught me I do not trust code I have not seen survive real load — SUBJZKEY.',
        tags: [],
      });

    await createCode(request, csrf, { code: CODE, label: 'intro', purpose: 'subj cite' });
    const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
    const stream = await sendMessage(request, sess, 'when do you consider software good enough to ship?');
    await stream.body();

    const convID = await firstConvID(request, csrf);
    const cited = await citedSubjectivityIDs(request, csrf, convID);
    expect(cited.has(subj.subjectivity_id),
      'a default subjectivity note grounds the voice but is NOT cited to the visitor').toBe(false);
    await request.dispose();
  });

  test('opt-in: a show_as_source subjectivity note IS cited to the visitor', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const apiToken = await createAPIToken(request, csrf, 'owner');
    const sid = await initMCP(request, apiToken);

    // the owner opts THIS subjectivity note into being citable.
    const subj = await callTool<{ subjectivity_id: string }>(request, apiToken, sid,
      'subjectivity_write', {
        title: 'Why I ship rough',
        body: 'Withholding a working thing to satisfy my own taste is vanity — SUBJPUBKEY.',
        tags: [],
        show_as_source: true,
      });

    await createCode(request, csrf, { code: CODE, label: 'intro', purpose: 'subj cite' });
    const sess = await issueSession(request, { handle: OWNER.handle, code: CODE, visitor_name: 'V' });
    const stream = await sendMessage(request, sess, 'when do you consider software good enough to ship?');
    await stream.body();

    const convID = await firstConvID(request, csrf);
    const cited = await citedSubjectivityIDs(request, csrf, convID);
    expect(cited.has(subj.subjectivity_id),
      'an opted-in (show_as_source) subjectivity note IS cited to the visitor').toBe(true);
    await request.dispose();
  });
});
