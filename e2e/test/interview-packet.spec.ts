// interview-packet.spec.ts —— BLACK BOX, docs/design/deepinterview-engine.md "Contracts between the
// two repos". A practice interview's engine is fed one self-contained packet per posting, and its
// report comes back onto the posting's ledger row.
//
// Contract: jobs.interview_packet {job_seen_id} → {fingerprint, body}; fingerprint = sha256 hex of
// body's exact UTF-8 bytes; body decodes to {version, source, company, title, jd_text,
// actual_work_profile, homework, scale_estimate, flags, deductions, cited_notes, corpus_scope:
// {uris, notes: [{uri, title, text}]}}. The scope holds the cv, each project root note and each
// cited note — nothing else. jobs.add_interview_report {job_seen_id, report} appends one report to
// the row's interview_reports; an empty report is refused.

import { createHash } from 'node:crypto';

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { seedWiki } from '@/fixtures/corpus';
import { allHistory, jobsAnnotate } from '@/fixtures/job-ledger';
import { callTool, callToolOutcome } from '@/fixtures/mcp';

interface Packet { fingerprint: string; body: string }
interface ScopeNote { uri: string; title: string; text: string }
interface Body {
  version: number;
  source: { job_seen_id: string; application_id: string | null };
  company: string; title: string; jd_text: string;
  actual_work_profile: string; homework: string;
  scale_estimate: null;
  flags: string[]; deductions: { points: number; why: string }[]; cited_notes: string[];
  corpus_scope: { uris: string[]; notes: ScopeNote[] };
}

let o: LoopOwner;
let seen = '';

const packet = (): Promise<Packet> =>
  callTool<Packet>(o.request, o.apiToken, o.sid, 'jobs.interview_packet', { job_seen_id: seen });
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'interviewpacket');
  seen = (o.jobs[0] as { job_seen_id?: string }).job_seen_id ?? '';
  expect(seen, 'presence: the pool row carries its ledger id').not.toBe('');
  await callTool(o.request, o.apiToken, o.sid, 'subjectivity_write', { title: 'cv', body: 'ZEBRACV staff engineer, 2019–2025.' });
  for (const n of [
    { title: 'zebra-app', path: 'software/project/zebra-app', body: 'ZEBRAPROJECT a ledger service.' },
    { title: 'zebra-cited', path: 'notes/zebra-cited', body: 'ZEBRACITED how the sandbox isolates builds.' },
    { title: 'zebra-outside', path: 'notes/zebra-outside', body: 'ZEBRAOUTSIDE a cooking note.' },
  ]) await seedWiki(o.request, o.apiToken, o.sid, n);
  await jobsAnnotate(o, seen, {
    brief: 'ZEBRABRIEF the merchant risk team.', homework: 'ZEBRAHOMEWORK why I fit.',
    cited_notes: ['notes/zebra-cited'], flags: ['visa-unclear'],
    deductions: [{ points: -1, why: 'on-site three days' }],
  });
});
test.afterAll(async () => { await o.request.dispose(); });

test('the packet is the contract, fingerprinted over its body', async () => {
  const p = await packet();
  expect(p.fingerprint, 'sha256 of the exact body').toBe(sha256(p.body));
  const b = JSON.parse(p.body) as Body;
  expect(b.version).toBe(1);
  expect(b.source.job_seen_id).toBe(seen);
  expect(b.company).toBe(o.jobs[0]!.company);
  expect(b.title).toBe(o.jobs[0]!.title);
  expect(b.jd_text.length, 'the posting text').toBeGreaterThan(0);
  expect(b.actual_work_profile).toBe('ZEBRABRIEF the merchant risk team.');
  expect(b.homework).toBe('ZEBRAHOMEWORK why I fit.');
  expect(b.scale_estimate, 'no Fermi chain yet: degraded, never invented').toBeNull();
  expect(b.flags).toEqual(['visa-unclear']);
  expect(b.deductions).toEqual([{ points: -1, why: 'on-site three days' }]);
  expect(b.cited_notes).toEqual(['notes/zebra-cited']);

  const texts = b.corpus_scope.notes.map((n) => n.text).join('\n');
  expect(texts, 'the cv').toContain('ZEBRACV');
  expect(texts, 'a project root note').toContain('ZEBRAPROJECT');
  expect(texts, 'the cited note').toContain('ZEBRACITED');
  expect(texts, 'nothing outside the scope').not.toContain('ZEBRAOUTSIDE');
  expect(b.corpus_scope.uris).toEqual(b.corpus_scope.notes.map((n) => n.uri));
});

test('the same row gives the same packet; a changed brief changes the fingerprint', async () => {
  const first = await packet();
  expect((await packet()).fingerprint, 'stable').toBe(first.fingerprint);
  await jobsAnnotate(o, seen, { brief: 'ZEBRABRIEF2 the payments team.' });
  expect((await packet()).fingerprint, 'a new version').not.toBe(first.fingerprint);
});

test('reports append to the row in order; an empty one is refused', async () => {
  for (const report of ['ZEBRAREPORT1 first practice', 'ZEBRAREPORT2 second practice']) {
    await callTool(o.request, o.apiToken, o.sid, 'jobs.add_interview_report', { job_seen_id: seen, report });
  }
  const row = (await allHistory(o)).find((r) => r.job_seen_id === seen);
  expect(row?.interview_reports).toEqual(['ZEBRAREPORT1 first practice', 'ZEBRAREPORT2 second practice']);
  const empty = await callToolOutcome(o.request, o.apiToken, o.sid, 'jobs.add_interview_report', { job_seen_id: seen, report: '  ' });
  expect(empty.isError).toBe(true);
  expect(empty.text).toMatch(/report/i);
});
