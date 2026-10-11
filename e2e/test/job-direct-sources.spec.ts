// job-direct-sources.spec.ts —— roadmap 4.3.d: an aggregator that links to a company's own ATS board
// names a source the owner can register directly.
//
// Contract: jobs.suggest_sources → {suggestions: [{kind, company, postings}]}: the greenhouse /
// lever / ashby boards the ledger's posting links point at, minus the boards already registered,
// most postings first. A link to any other site suggests nothing.

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { jobsRegisterSource } from '@/fixtures/jobs';
import { jobsRecord } from '@/fixtures/job-ledger';
import { callTool } from '@/fixtures/mcp';

interface Suggestion { kind: string; company: string; postings: number }

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'directsources');
});
test.afterAll(async () => { await o.request.dispose(); });

test('4.3.d — boards the links point at are suggested; registered ones are not', async () => {
  await jobsRegisterSource(o.request, o.apiToken, o.sid, {
    kind: 'greenhouse', label: 'betalabs GH', config: { company: 'betalabs' },
  });
  await jobsRecord(o, [
    { title: 'Data Engineer', company: 'Foo', url: 'https://jobs.lever.co/foo/a1', source: 'himalayas' },
    { title: 'ML Engineer', company: 'Foo', url: 'https://jobs.lever.co/foo/a2', source: 'himalayas' },
    { title: 'SRE', company: 'Acme', url: 'https://job-boards.greenhouse.io/acme/jobs/7', source: 'jba' },
    { title: 'Designer', company: 'Beta Labs', url: 'https://boards.greenhouse.io/betalabs/jobs/9', source: 'jba' },
    { title: 'PM', company: 'Elsewhere', url: 'https://www.linkedin.com/jobs/view/55', source: 'linkedin' },
  ]);
  const res = await callTool<{ suggestions: Suggestion[] }>(
    o.request, o.apiToken, o.sid, 'jobs.suggest_sources', {});
  expect(res.suggestions).toEqual([
    { kind: 'lever', company: 'foo', postings: 2 },
    { kind: 'greenhouse', company: 'acme', postings: 1 },
  ]);
});
