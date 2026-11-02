// applications-update-resume.spec.ts —— editing a committed application's tailored résumé
// (applications.update_resume) changes what the cue card reads, live. Masters (resume.master_update)
// and drafts (resume.update_draft) already had edit paths; a COMMITTED application's résumé had none.
// The card reads resume_content with no deck cache, so an edit shows on the next card
// (cue-resume-grounding §5, freshness). Red on pre-tool code: applications.update_resume does not
// exist, so the edit call cannot resolve.

import type { Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { createAPIToken } from '@/fixtures/admin';
import { callTool, initMCP } from '@/fixtures/mcp';
import { createRole } from '@/fixtures/roles';
import { seedWiki } from '@/fixtures/corpus';
import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const ROLE = 'cue-hiring';

type Markers = { summary: string; bullet: string; skill: string };
const BEFORE: Markers = {
  summary: 'BEFORE-SUMMARY backend engineer who rebuilt the retrieval eval.',
  bullet: 'BEFORE-BULLET led retrieval quality from 38% to 71%.',
  skill: 'BEFORE-SKILL-RAG',
};
const AFTER: Markers = {
  summary: 'AFTER-SUMMARY platform engineer who shipped the plugin sandbox.',
  bullet: 'AFTER-BULLET cut cold-start from 900ms to 120ms.',
  skill: 'AFTER-SKILL-WASM',
};

interface Prompt {
  system: string;
  context: string;
  sources: string[];
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

// context —— assistant.context for a background question, bound to the application by its code. A fresh
// token per call keeps the sessions independent, so a stale read can't hide behind a reused session.
async function context(o: LoopOwner, code: string): Promise<Prompt> {
  const token = await createAPIToken(o.request, o.csrf, `upd-resume-${Math.random().toString(36).slice(2, 8)}`);
  const sid = await initMCP(o.request, token);
  return callTool<Prompt>(o.request, token, sid, 'assistant.context', {
    role_id: ROLE, rewrite: false, code,
    question: 'Tell me about your background and why you want this role.',
  });
}

test.describe('applications.update_resume edits the committed résumé the cue card reads', () => {
  let owner: LoopOwner;
  let appID: string;
  let code: string;

  test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
    test.setTimeout(180_000);
    const o = await setupLoopOwner(playwright, 'updresume');
    await seedWiki(o.request, o.apiToken, o.sid, {
      title: 'platform', path: 'software/platform',
      body: 'The platform runs each plugin in its own sandbox; the backend never holds docker.sock.',
    });
    await createRole(o.request, o.csrf, {
      name: ROLE, description: 'Hiring interview', corpus_uris: ['wiki://software/**'],
    });
    const job = o.jobs[0];
    if (!job) throw new Error('setupLoopOwner fetched no jobs');
    const drafted = await resumeDraft(o.request, o.apiToken, o.sid, job.cache_id, resumeWith(BEFORE));
    const c = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
    owner = o;
    appID = c.view.application_id;
    code = c.view.access_code_id;
  });

  test('an edit shows on the next card, and the old résumé is gone', async () => {
    const before = await context(owner, code);
    expect(before.context, 'the committed résumé is read first').toContain(BEFORE.summary);

    await callTool(owner.request, owner.apiToken, owner.sid, 'applications.update_resume', {
      application_id: appID, resume_content: resumeWith(AFTER),
    });

    const after = await context(owner, code);
    expect(after.context, 'the edited résumé is read live (no cache)').toContain(AFTER.summary);
    expect(after.context, 'a work bullet from the edit is present').toContain(AFTER.bullet);
    expect(after.context, 'the old résumé is gone').not.toContain(BEFORE.summary);
  });

  test('a bogus application id is a clean error, not a silent no-op', async () => {
    const token = await createAPIToken(owner.request, owner.csrf, 'upd-resume-bad');
    const sid = await initMCP(owner.request, token);
    await expect(callTool(owner.request, token, sid, 'applications.update_resume', {
      application_id: '00000000-0000-0000-0000-000000000000', resume_content: resumeWith(AFTER),
    })).rejects.toThrow(/not found/i);
  });
});
