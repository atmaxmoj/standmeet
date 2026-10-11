// resume-strict-fields.spec.ts —— roadmap 5.3.a/b: the PDF an ATS reads is complete and in order.
//
// "Done" (roadmap): a misnamed resume_content key is refused with its name; the text extracted from
// the committed PDF runs name → works → education → skills.
//
// Contract:
//   - resume.draft / resume.update_draft / resume.master_* refuse resume_content with a key the
//     schema does not have, at any depth; the error names the key. Nothing is written.
//   - The committed PDF's text layer (what an ATS parses) has the name first, then every work in
//     order, then education, then skills.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { callToolOutcome } from '@/fixtures/mcp';
import { inspectPDF } from '@/fixtures/pdf-inspect';
import { applicationsCommit, resumeDraftWith, sampleResumeContent } from '@/fixtures/resume';

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'strictfields');
});
test.afterAll(async () => { await o.request.dispose(); });

test('5.3.a — a key the résumé does not have is refused by its name, at any depth', async () => {
  const deep = sampleResumeContent() as unknown as { works: Record<string, unknown>[] };
  deep.works[0]!['institution'] = 'Acme';
  const refused = await callToolOutcome(o.request, o.apiToken, o.sid, 'resume.draft',
    { job_cache_id: o.jobs[0]!.cache_id, resume_content: deep });
  expect(refused.isError, 'refused').toBe(true);
  expect(refused.text, 'the error names the key').toContain('institution');

  const top = { ...sampleResumeContent(), experience: [] };
  const refusedTop = await callToolOutcome(o.request, o.apiToken, o.sid, 'resume.draft',
    { job_cache_id: o.jobs[0]!.cache_id, resume_content: top });
  expect(refusedTop.text, 'a top-level key too').toContain('experience');

  const ok = await callToolOutcome(o.request, o.apiToken, o.sid, 'resume.draft',
    { job_cache_id: o.jobs[0]!.cache_id, resume_content: sampleResumeContent() });
  expect(ok.isError, `presence: the same content without it drafts: ${ok.text}`).toBe(false);
});

test('5.3.b — the committed PDF reads name, works in order, education, then skills', async () => {
  const content = sampleResumeContent();
  const drafted = await resumeDraftWith(o.request, o.apiToken, o.sid,
    { job_cache_id: o.jobs[1]!.cache_id, resume_content: content });
  const c = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
  const text = (await inspectPDF(c.pdf)).text.toLowerCase();
  const at = (s: string): number => {
    const i = text.indexOf(s.toLowerCase());
    expect(i, `"${s}" is in the PDF text`).toBeGreaterThanOrEqual(0);
    return i;
  };
  const order = [
    at(content.identity.name),
    at(content.works[0]!.company),
    at(content.works[1]!.company),
    at(content.educations[0]!.school),
    at(content.skills[0]!.items[0]!),
  ];
  expect(order, 'name → works → education → skills').toEqual([...order].sort((a, b) => a - b));
});
