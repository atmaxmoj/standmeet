// draft-check-vs-master.spec.ts —— roadmap 5.1.a/b/c: a draft cannot change my titles, dates or
// order, or state my immigration status, without me approving each change by name.
//
// "Done" (roadmap): a changed title blocks commit unless accepted; a draft mentioning permanent
// residence, citizenship, visa or work permit blocks commit; "2 years 11 months", "pull request
// (PR)", a dropped work and rewritten bullets do not fire.
//
// Contract:
//   - resume.draft / resume.update_draft receipts carry `check: {coverage: 'master'|'none',
//     findings: [{key, kind, master, draft}]}`; they never refuse (the owner is still editing).
//     key names the field: works[0].title, identity.phone, summary, works[0].bullets[1] …
//     kind: changed | unpaired | order | immigration.
//   - The reference is the draft's based_on master read NOW, else the default master, else none.
//   - applications.commit refuses while any finding is not in `accept: [key…]`; the refusal names
//     each key with the master value and the draft value; nothing is committed.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { callToolMulti, callToolOutcome } from '@/fixtures/mcp';
import { querySQL } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';
import { mcpMasterCreate, mcpMasterDelete, mcpMasterUpdate } from '@/fixtures/resume-masters';
import { resumeDraftWith, sampleResumeContent, type ResumeContent } from '@/fixtures/resume';

interface Finding { key: string; kind: string; master: string; draft: string }
interface Check { coverage: string; findings: Finding[] }

let o: LoopOwner;
let masterID = '';
let draftID = '';
const base = sampleResumeContent();

test.use({ ownerCredentials: { email: 'draftcheck@example.com', password: 'correct-horse-battery-staple' } });
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'draftcheck');
  const m = await mcpMasterCreate(ctx(), { name: 'Main', resume_content: base, is_default: true });
  masterID = m.id;
  const d = await resumeDraftWith(o.request, o.apiToken, o.sid,
    { job_cache_id: o.jobs[0]!.cache_id, master_id: masterID });
  draftID = d.view.draft_id;
});
test.afterAll(async () => { await o.request.dispose(); });

function ctx(): { request: APIRequestContext; token: string; sid: string } {
  return { request: o.request, token: o.apiToken, sid: o.sid };
}

async function update(content: ResumeContent): Promise<Check> {
  const parts = await callToolMulti(o.request, o.apiToken, o.sid, 'resume.update_draft',
    { draft_id: draftID, resume_content: content });
  const text = parts.find((p) => p.type === 'text');
  if (!text || text.type !== 'text') throw new Error('update_draft: no text part');
  return (JSON.parse(text.text) as { check: Check }).check;
}

function keys(c: Check): string[] { return c.findings.map((f) => f.key).sort(); }

const committed = (): number =>
  Number(querySQL('SELECT count(*) FROM applications'));

test('5.1.a — a changed title is the one finding; a dropped work, new bullets and a new summary are not', async () => {
  const content = structuredClone(base);
  content.works[0]!.title = 'principal engineer';
  content.works[0]!.bullets = ['Rewrote everything about this role.', 'Shipped a pull request (PR) a day.'];
  content.works.splice(1, 1);
  content.summary = 'A different summary: 2 years 11 months on the platform team.';
  const check = await update(content);
  expect(check.coverage, 'the master is the reference').toBe('master');
  expect(check.findings).toEqual([
    { key: 'works[0].title', kind: 'changed', master: 'staff engineer', draft: 'principal engineer' },
  ]);
});

test('5.1.c — commit is refused until that finding is accepted by name', async () => {
  const before = committed();
  const refused = await callToolOutcome(o.request, o.apiToken, o.sid, 'applications.commit', { draft_id: draftID });
  expect(refused.isError, 'refused').toBe(true);
  expect(refused.text).toContain('works[0].title');
  expect(refused.text).toContain('staff engineer');
  expect(refused.text).toContain('principal engineer');
  expect(committed(), 'nothing committed').toBe(before);

  const wrongKey = await callToolOutcome(o.request, o.apiToken, o.sid, 'applications.commit',
    { draft_id: draftID, accept: ['works[1].title'] });
  expect(wrongKey.isError, 'accepting another key is not accepting this one').toBe(true);

  const ok = await callToolOutcome(o.request, o.apiToken, o.sid, 'applications.commit',
    { draft_id: draftID, accept: ['works[0].title'] });
  expect(ok.isError, `accepted by name, it commits: ${ok.text}`).toBe(false);
  expect(committed()).toBe(before + 1);
});

test('5.1.a — a fact fixed in the master after the draft was made is a finding', async () => {
  const d = await resumeDraftWith(o.request, o.apiToken, o.sid,
    { job_cache_id: o.jobs[1]!.cache_id, master_id: masterID });
  draftID = d.view.draft_id;
  const fixed = structuredClone(base);
  fixed.identity.phone = '+1 415 555 0199';
  await mcpMasterUpdate(ctx(), { master_id: masterID, resume_content: fixed });
  const check = await update(base);
  expect(check.findings).toEqual([
    { key: 'identity.phone', kind: 'changed', master: '+1 415 555 0199', draft: '+1 415 555 0100' },
  ]);
  await mcpMasterUpdate(ctx(), { master_id: masterID, resume_content: base });
});

test('5.1.b — an immigration or work-authorization term is a finding, in English and Chinese', async () => {
  const content = structuredClone(base);
  content.summary = 'Canadian permanent resident, open to relocation.';
  content.works[0]!.bullets = [...content.works[0]!.bullets, '持有工作签证，可随时入职。'];
  const check = await update(content);
  const immigration = check.findings.filter((f) => f.kind === 'immigration').map((f) => f.key).sort();
  expect(immigration).toEqual(['summary', `works[0].bullets[${base.works[0]!.bullets.length}]`]);
  expect(keys(check).every((k) => k === 'summary' || k.startsWith('works[0].bullets')), 'nothing else fired').toBe(true);
});

// 5.1.d —— the composer's send dialog lists each finding with its own confirm box
// (`composer-finding-<key>`, a checkbox); send stays disabled until every box is ticked.
test('5.1.d — the composer lists the change and sends only once it is confirmed', async ({ adminPage: page }) => {
  const changedTitle = structuredClone(base);
  changedTitle.works[0]!.title = 'head of engineering';
  await update(changedTitle);
  const before = committed();
  await gotoAdminSection(page, 'drafts');
  await page.getByRole('button', { name: /open composer/i }).first().click();
  await page.getByTestId('composer-send').click();
  const finding = page.getByTestId('composer-finding-works[0].title');
  await expect(finding, 'the change is listed').toContainText('head of engineering', { timeout: 15_000 });
  await expect(finding).toContainText('staff engineer');
  const send = page.getByTestId('composer-confirm-send');
  await expect(send, 'not before it is confirmed').toBeDisabled();
  await finding.getByRole('checkbox').check();
  await expect(send).toBeEnabled();
  await send.click();
  await expect.poll(committed, { timeout: 30_000, message: 'committed after confirming' }).toBe(before + 1);
});

test('a draft with no master and no default has no reference, and says so', async () => {
  await mcpMasterDelete(ctx(), masterID);
  const d = await resumeDraftWith(o.request, o.apiToken, o.sid,
    { job_cache_id: o.jobs[2]!.cache_id, resume_content: base });
  draftID = d.view.draft_id;
  const check = await update(base);
  expect(check).toEqual({ coverage: 'none', findings: [] });
});
