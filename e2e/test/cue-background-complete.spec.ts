// cue-background-complete.spec.ts —— a background/intro question's card carries the WHOLE résumé:
// the summary and EVERY experience (卡片完整度 spec). The card is a model rewrite under a terse format,
// so coverage used to vary run to run; the server appends the deterministic full recap, so the card is
// always complete and STABLE across runs (acceptance 3). Red on pre-feat code: the card held only what
// the model's reply sampled — here the scripted reply names no experience, yet the card lists them all.
//
// Driven through assistant.cue (the real card path, model call) because the recap is in the CARD, not
// the context. The recap is deterministic, so the mock's reply content does not affect completeness.

import type { Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { createAPIToken } from '@/fixtures/admin';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { setupLoopOwner, type Committed, type LoopOwner } from '@/fixtures/application-loop';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const ROLE = 'cue-hiring';
const BG_QUESTION = 'Tell me about your background and why you want this role.';
// the scripted model reply names NONE of the experiences — so if the card lists them, it is the
// server's deterministic recap doing it, not the model.
const MODEL_REPLY = '**Key: background**\n**A software engineer.**';

interface Cue {
  card: string;
  feed_id: string;
}

type Resume = { summary: string; companies: string[] };
const RESUME_A: Resume = {
  summary: 'ALPHA-SUMMARY math background, three years industry, builds end to end.',
  companies: ['ACME-ALPHA', 'BRAVO-LABS', 'CHARLIE-CO'],
};
const RESUME_B: Resume = {
  summary: 'BETA-SUMMARY platform engineer who shipped a plugin sandbox.',
  companies: ['DELTA-DYNE', 'ECHO-WORKS', 'FOXTROT-LLC'],
};

function resumeContent(r: Resume) {
  return sampleResumeContent({
    summary: r.summary,
    works: r.companies.map((c) => ({
      title: 'engineer', company: c, location: 'Remote',
      period: { start: '2022-01', end: '' }, bullets: [`${c}-BULLET shipped the thing`],
    })),
    skills: [{ category: 'core', items: ['SKILL-X'] }],
  });
}

// card —— a cue card for a question, optionally bound to an application by code. A fresh scripted reply
// (naming no experience) per call, so a complete card can only come from the server's recap.
async function card(o: LoopOwner, code: string | undefined, question: string): Promise<string> {
  const token = await createAPIToken(o.request, o.csrf, `bg-${Math.random().toString(36).slice(2, 8)}`);
  const sid = await initMCP(o.request, token);
  const tag = await scriptMockReplyText(o.request, MODEL_REPLY);
  const args: Record<string, unknown> = { role_id: ROLE, rewrite: false, question: `${question} ${tag}` };
  if (code) args['code'] = code;
  const cue = await callTool<Cue>(o.request, token, sid, 'assistant.cue', args);
  return cue.card;
}

let owner: LoopOwner;
let appA: Committed;
let appB: Committed;

test.describe('a background card carries the whole résumé (卡片完整度)', () => {
  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    ({ owner, appA, appB } = await seedOwner(playwright));
  });

  test('every experience and the summary are present, and stable across 3 runs', async () => {
    for (let i = 0; i < 3; i++) {
      const c = await card(owner, appA.codeID, BG_QUESTION);
      expect(c, `run ${i}: the summary is present`).toContain(RESUME_A.summary);
      for (const company of RESUME_A.companies) {
        expect(c, `run ${i}: experience ${company} is present`).toContain(company);
      }
    }
  });

  test('a session with no bound résumé is unchanged (no recap)', async () => {
    const c = await card(owner, undefined, BG_QUESTION);
    expect(c).not.toContain('from your résumé');
    for (const company of [...RESUME_A.companies, ...RESUME_B.companies]) {
      expect(c, `${company} must not appear without a binding`).not.toContain(company);
    }
  });

  test('isolation: another code reads that résumé in full, never the first’s', async () => {
    const c = await card(owner, appB.codeID, BG_QUESTION);
    expect(c).toContain(RESUME_B.summary);
    for (const company of RESUME_B.companies) expect(c).toContain(company);
    for (const company of RESUME_A.companies) {
      expect(c, `${company} (A) must not leak into B’s card`).not.toContain(company);
    }
  });
});

// seedOwner —— an owner on the mock model, an in-scope note and a hiring role, and two committed
// applications with distinct multi-experience résumés (so isolation and completeness both bite).
async function seedOwner(
  playwright: Playwright,
): Promise<{ owner: LoopOwner; appA: Committed; appB: Committed }> {
  const o = await setupLoopOwner(playwright, 'bgcomplete');
  await seedWiki(o.request, o.apiToken, o.sid, {
    title: 'platform', path: 'software/platform',
    body: 'The platform runs each plugin in its own sandbox; the backend never holds docker.sock.',
  });
  await createRole(o.request, o.csrf, {
    name: ROLE, description: 'Hiring interview', corpus_uris: ['wiki://software/**'],
  });
  return { owner: o, appA: await commit(o, 0, RESUME_A), appB: await commit(o, 1, RESUME_B) };
}

async function commit(o: LoopOwner, n: number, r: Resume): Promise<Committed> {
  const job = o.jobs[n];
  if (!job) throw new Error(`setupLoopOwner fetched no job #${n}`);
  const drafted = await resumeDraft(o.request, o.apiToken, o.sid, job.cache_id, resumeContent(r));
  const c = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
  return { applicationID: c.view.application_id, codeID: c.view.access_code_id, code: c.view.access_code, job };
}
