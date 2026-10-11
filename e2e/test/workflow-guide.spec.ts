// workflow-guide.spec.ts —— roadmap 6.1 / 6.3: my AI gets the workflows from the instance, every
// tool a workflow names exists, and one call tells me what the job loop is missing.
//
// "Done" (roadmap): a fresh owner MCP session can read resume-tailoring, job-description-reading
// and interview-prep from the instance; a guide naming a missing tool fails; an instance without a
// cv note, a master or a looking-for note lists exactly those.
//
// Contract:
//   - workflow.guide {} → {guides: [{name, title, use_when}]}; {name} → {name, guide} (markdown).
//   - The MCP server instructions name workflow.guide.
//   - 6.1.b: every tool named in backticks in any guide (workflow.guide's and microsite.guide's),
//     and every dotted tool name in the server instructions, is one tools/list serves a full key.
//   - workflow.doctor {} → {missing: [{item: 'cv'|'master'|'looking_for', fix}], ready}.
//     cv = a subjectivity note titled "cv"; looking_for = one titled "Looking for".

import { test, expect } from '@/fixtures/test';

import { setupLoopOwner, type LoopOwner } from '@/fixtures/application-loop';
import { callTool, listTools, serverInstructions } from '@/fixtures/mcp';
import { mcpMasterCreate } from '@/fixtures/resume-masters';
import { sampleResumeContent } from '@/fixtures/resume';

interface Guide { name: string; title: string; use_when: string }
interface Doctor { missing: { item: string; fix: string }[]; ready: boolean }

let o: LoopOwner;

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(600_000);
  o = await setupLoopOwner(playwright, 'workflowguide');
});
test.afterAll(async () => { await o.request.dispose(); });

const guide = (name: string): Promise<{ name: string; guide: string }> =>
  callTool(o.request, o.apiToken, o.sid, 'workflow.guide', { name });

test('6.1.a — the instance serves the job-loop workflows, and the instructions point to them', async () => {
  const list = (await callTool<{ guides: Guide[] }>(o.request, o.apiToken, o.sid, 'workflow.guide', {})).guides;
  const names = list.map((g) => g.name);
  for (const want of ['resume-tailoring', 'job-description-reading', 'interview-prep']) {
    expect(names, `${want} is served`).toContain(want);
  }
  for (const g of list) {
    expect(g.use_when, `${g.name} says when to use it`).toMatch(/^Use this guide when/);
    const body = (await guide(g.name)).guide;
    expect(body.startsWith(`# ${g.title}`), `${g.name} is its markdown`).toBe(true);
  }
  expect(await serverInstructions(o.request, o.apiToken), 'the instructions name it').toContain('workflow.guide');
});

test('6.1.b — every tool a workflow names is a tool this instance serves', async () => {
  const served = new Set((await listTools(o.request, o.apiToken, o.sid)).map((t) => t.name));
  const texts: [string, string][] = [];
  for (const g of (await callTool<{ guides: Guide[] }>(o.request, o.apiToken, o.sid, 'workflow.guide', {})).guides) {
    texts.push([g.name, (await guide(g.name)).guide]);
  }
  texts.push(['microsite.guide', (await callTool<{ guide: string }>(o.request, o.apiToken, o.sid, 'microsite.guide', {})).guide]);
  // A dotted name in a namespace the owner's tools use (jobs., resume., corpus., …) is a tool
  // name, and must be served. Other dotted text (navigator.language, theme.css) and the visitor
  // agent's own tools (corpus_search) are not owner tools and are not checked.
  const namespaces = new Set([...served].filter((n) => n.includes('.')).map((n) => n.split('.')[0]!));
  const named: [string, string][] = [];
  for (const [where, text] of texts) {
    for (const m of text.matchAll(/`([a-z]+\.[a-z_]+)`/g)) named.push([where, m[1]!]);
  }
  for (const m of (await serverInstructions(o.request, o.apiToken)).matchAll(/\b([a-z]+\.[a-z_]{3,})\b/g)) {
    named.push(['server instructions', m[1]!]);
  }
  const tools = named.filter(([, n]) => namespaces.has(n.split('.')[0]!));
  expect(tools.length, 'presence: the texts name tools').toBeGreaterThan(20);
  const missing = tools.filter(([, n]) => !served.has(n)).map(([w, n]) => `${w}: ${n}`);
  expect(missing, 'tools named in agent-facing text that the instance does not serve').toEqual([]);
});

test('6.3.a — the doctor lists exactly what the job loop is missing', async () => {
  const doctor = (): Promise<Doctor> => callTool<Doctor>(o.request, o.apiToken, o.sid, 'workflow.doctor', {});
  const fresh = await doctor();
  expect(fresh.missing.map((m) => m.item).sort()).toEqual(['cv', 'looking_for', 'master']);
  expect(fresh.ready).toBe(false);
  expect(fresh.missing.every((m) => m.fix.length > 0), 'each says how to fix it').toBe(true);

  await mcpMasterCreate({ request: o.request, token: o.apiToken, sid: o.sid },
    { name: 'Main', resume_content: sampleResumeContent(), is_default: true });
  await callTool(o.request, o.apiToken, o.sid, 'subjectivity_write', { title: 'cv', body: 'Acme 2023–now; Stripe 2018–2022.' });
  expect((await doctor()).missing.map((m) => m.item), 'only what is still missing').toEqual(['looking_for']);

  await callTool(o.request, o.apiToken, o.sid, 'subjectivity_write', { title: 'Looking for', body: 'Staff backend, remote.' });
  expect(await doctor()).toEqual({ missing: [], ready: true });
});
