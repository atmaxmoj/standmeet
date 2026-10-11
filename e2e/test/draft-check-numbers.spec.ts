// draft-check-numbers.spec.ts —— roadmap 5.2.a: I am warned about numbers with no source.
//
// "Done" (roadmap): an invented number is listed as unsupported; a zh draft reports coverage partial
// rather than "0 unsupported". Years and durations are not claims.
//
// Contract: the resume.update_draft receipt carries `numbers: {coverage: 'full'|'partial'|'none',
// unsupported: [{key, claim, text}]}` beside `check`. A number is supported when the master states
// it. Warnings only: nothing is refused for a number.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { callToolMulti } from '@/fixtures/mcp';
import { mcpMasterCreate } from '@/fixtures/resume-masters';
import { resumeDraftWith, sampleResumeContent, type ResumeContent } from '@/fixtures/resume';

interface Claim { key: string; claim: string; text: string }
interface Numbers { coverage: string; unsupported: Claim[] }

let o: LoopOwner;
let draftID = '';
const base = sampleResumeContent();

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'draftnumbers');
  const m = await mcpMasterCreate({ request: o.request, token: o.apiToken, sid: o.sid },
    { name: 'Main', resume_content: base, is_default: true });
  draftID = (await resumeDraftWith(o.request, o.apiToken, o.sid,
    { job_cache_id: o.jobs[0]!.cache_id, master_id: m.id })).view.draft_id;
});
test.afterAll(async () => { await o.request.dispose(); });

async function numbers(content: ResumeContent): Promise<Numbers> {
  const parts = await callToolMulti(o.request, o.apiToken, o.sid, 'resume.update_draft',
    { draft_id: draftID, resume_content: content });
  const text = parts.find((p) => p.type === 'text');
  if (!text || text.type !== 'text') throw new Error('update_draft: no text part');
  return (JSON.parse(text.text) as { numbers: Numbers }).numbers;
}

test('the master\'s own numbers are supported; nothing to report', async () => {
  expect(await numbers(base)).toEqual({ coverage: 'full', unsupported: [] });
});

test('an invented number is listed; a year and a duration are not', async () => {
  const content = structuredClone(base);
  const n = content.works[0]!.bullets.length;
  content.works[0]!.bullets.push('Cut p99 latency by 40% in 2021, over 2 years 11 months.');
  const got = await numbers(content);
  expect(got.coverage).toBe('full');
  expect(got.unsupported).toEqual([
    { key: `works[0].bullets[${n}]`, claim: '40%', text: 'Cut p99 latency by 40% in 2021, over 2 years 11 months.' },
  ]);
});

test('a Chinese draft says partial, not "nothing unsupported"', async () => {
  const content = structuredClone(base);
  content.summary = '后端工程师，把检索准确率提高了百分之四十。';
  const got = await numbers(content);
  expect(got.coverage, 'Chinese numerals are not read').toBe('partial');
});
