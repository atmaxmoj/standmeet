// assistant-cue-resume.spec.ts —— the cue card reads the tailored résumé of the application the
// session's code is bound to (spec standmeet-cue-resume-grounding-2026-11-01: "会话是用某个 code
// 打开的，卡片就读这个 code 对应那次投递的简历"). Today a card's material is the role's notes + the
// locked job's brief only; the committed application's résumé never reaches it, so S1's background
// card is generic.
//
// Criteria (each goes red on the pre-fix code):
//   1. a call bound to an application's code → the context carries that application's résumé: the
//      summary verbatim, a work bullet, and the skills line (spec acceptance 1).
//   2. a session with no code → no résumé block (the old behaviour, unchanged — spec acceptance 3).
//   3. isolation: a call bound to another application's code reads THAT application's résumé, never
//      the first's; binding is by code, not by the company named (spec acceptance 4). Two codes to
//      the same board prove it is the code that selects, not the company.
//   4. assistant.applications lists the committed applications the start screen binds to, each with
//      its code — the picker's data path.
//
// The surface is assistant.context (the prompt, no model call) so the assertions are deterministic:
// what matters is that the résumé facts reach the material the card is written from. Whether the
// model then quotes them, and honesty / freshness on real data, are the eval's job (spec acceptance
// 2/5), not a mock's.

import type { Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { createAPIToken } from '@/fixtures/admin';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { setupLoopOwner, type Committed, type LoopOwner } from '@/fixtures/application-loop';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const ROLE = 'cue-hiring';

interface Prompt {
  system: string;
  context: string;
  sources: string[];
  matrix: string;
  stack_named: string[];
}

type Markers = { summary: string; bullet: string; skill: string };

// distinctive markers so an assertion means "this résumé reached the card", not a coincidence. Two
// applications, two marker sets: isolation asserts one set reaches the card and the other does not.
const RESUME_A: Markers = {
  summary: 'ALPHA-SUMMARY backend engineer who rebuilt the retrieval eval.',
  bullet: 'ALPHA-BULLET led retrieval quality from 38% to 71% in nine months.',
  skill: 'ALPHA-SKILL-RAG',
};
const RESUME_B: Markers = {
  summary: 'BETA-SUMMARY platform engineer who shipped the plugin sandbox.',
  bullet: 'BETA-BULLET cut cold-start from 900ms to 120ms across the fleet.',
  skill: 'BETA-SKILL-WASM',
};

// context —— assistant.context for a question, bound to an application by its code (or none). A fresh
// token per call keeps the sessions independent. Uses the owner's authenticated context (o.request):
// creating a keypair needs the owner session cookie, which the bare per-test request fixture lacks.
async function context(o: LoopOwner, code: string): Promise<Prompt> {
  const token = await createAPIToken(o.request, o.csrf, `cue-resume-${Math.random().toString(36).slice(2, 8)}`);
  const sid = await initMCP(o.request, token);
  const args: Record<string, unknown> = {
    role_id: ROLE, rewrite: false,
    question: 'Tell me about your background and why you want this role.',
  };
  if (code) args['code'] = code;
  return callTool<Prompt>(o.request, token, sid, 'assistant.context', args);
}

let owner: LoopOwner;
let appA: Committed;
let appB: Committed;

test.describe('assistant.cue reads the application résumé bound by code', () => {
  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(180_000);
    ({ owner, appA, appB } = await seedOwnerWithApplications(playwright));
  });

  test('a call bound to an application’s code carries that application’s résumé', async () => {
    const p = await context(owner, appA.codeID);
    expect(p.context, 'the summary is quoted verbatim').toContain(RESUME_A.summary);
    expect(p.context, 'a work bullet is present').toContain(RESUME_A.bullet);
    expect(p.context, 'the skills line is present').toContain(RESUME_A.skill);
    expect(p.context).toContain(appA.job.company);
  });

  test('a session with no code gets no résumé block', async () => {
    const p = await context(owner, '');
    expect(p.context).not.toContain('résumé for this application');
    expect(p.context).not.toContain(RESUME_A.summary);
    expect(p.context).not.toContain(RESUME_B.summary);
  });

  test('another application’s code reads that application’s résumé, never the first’s', async () => {
    const pB = await context(owner, appB.codeID);
    expect(pB.context, 'B’s résumé reaches B’s session').toContain(RESUME_B.summary);
    expect(pB.context, 'B’s bullet reaches B’s session').toContain(RESUME_B.bullet);
    expect(pB.context, 'A’s résumé never leaks into B’s session').not.toContain(RESUME_A.summary);
    expect(pB.context).not.toContain(RESUME_A.bullet);

    const pA = await context(owner, appA.codeID);
    expect(pA.context, 'A’s session still reads A, not B').toContain(RESUME_A.summary);
    expect(pA.context).not.toContain(RESUME_B.summary);
  });

  test('assistant.applications lists the committed applications with their codes', async () => {
    const token = await createAPIToken(owner.request, owner.csrf, 'cue-resume-apps');
    const sid = await initMCP(owner.request, token);
    const { applications } = await callTool<{ applications: { code: string; company: string; title: string }[] }>(
      owner.request, token, sid, 'assistant.applications', {},
    );
    const codes = applications.map((a) => a.code);
    expect(codes).toContain(appA.codeID);
    expect(codes).toContain(appB.codeID);
  });
});

// seedOwnerWithApplications —— an owner on the mock model, one in-scope note and a hiring role, and
// two committed applications with distinct marked résumés (so isolation is by code, not company).
async function seedOwnerWithApplications(
  playwright: Playwright,
): Promise<{ owner: LoopOwner; appA: Committed; appB: Committed }> {
  // claim() already seeds a default mock provider; assistant.context builds the prompt without a
  // model call, so no provider setup is needed here.
  const o = await setupLoopOwner(playwright, 'cueresume');
  await seedWiki(o.request, o.apiToken, o.sid, {
    title: 'platform', path: 'software/platform',
    body: 'The platform runs each plugin in its own sandbox; the backend never holds docker.sock.',
  });
  await createRole(o.request, o.csrf, {
    name: ROLE, description: 'Hiring interview', corpus_uris: ['wiki://software/**'],
  });
  const appA = await commitMarked(o, 0, RESUME_A);
  const appB = await commitMarked(o, 1, RESUME_B);
  return { owner: o, appA, appB };
}

// commitMarked —— draft the n-th fetched job with a marked résumé and commit it: one application,
// one fresh code bound to that résumé.
async function commitMarked(o: LoopOwner, n: number, m: Markers): Promise<Committed> {
  const job = o.jobs[n];
  if (!job) throw new Error(`setupLoopOwner fetched no job #${n}`);
  const drafted = await resumeDraft(o.request, o.apiToken, o.sid, job.cache_id, resumeWith(m));
  const c = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
  return {
    applicationID: c.view.application_id, codeID: c.view.access_code_id,
    code: c.view.access_code, job,
  };
}

function resumeWith(m: Markers) {
  return sampleResumeContent({
    summary: m.summary,
    works: [{
      title: 'staff engineer', company: 'Acme', location: 'Remote',
      period: { start: '2023-01', end: '' }, bullets: [m.bullet],
    }],
    skills: [{ category: 'core', items: [m.skill] }],
  });
}
