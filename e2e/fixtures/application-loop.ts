// application-loop.ts —— the shared fixture for the job-loop roadmap's E1 specs ("投出去的看得见"):
// an owner with one committed application, and the reads and writes an application's life uses.
//
// Contract (defined while RED; the implementation must satisfy it — roadmap E1):
//   Admin (owner session):
//     GET  /api/admin/applications            → {items: ApplicationRow[], next_cursor, total}
//     GET  /api/admin/applications/{id}       → ApplicationRow & {outcomes: OutcomeRow[]}
//     POST /api/admin/applications/{id}/outcome {outcome, note} → ApplicationRow
//   ApplicationRow adds:
//     opened_at  —— the first non-bot visit carrying the code, or the first conversation on it,
//                   whichever is earlier; null until then (1.1.b)
//     questions  —— visitor messages across the code's conversations (1.1.b)
//     outcome    —— none | responded | interview | offer | rejected | hired | withdrawn (1.3)
//   Owner MCP:
//     applications.update_outcome {application_id, outcome, note?} → ApplicationRow &
//       {bound?: {embeds: string[], microsites: string[]}} (bound only when withdrawn, 1.4.b)
//   Events (webhook-exposed, filterable by code_id):
//     application.engaged          {application_id, code_id, conversation_id} —— once per application
//     application.outcome_changed  {application_id, from, to, note}
//     application.followup_due     (declared with its trigger, E3)

import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { jobsFetchNew, jobsRegisterSource, type FetchedJobView } from '@/fixtures/jobs';
import { callTool, initMCP } from '@/fixtures/mcp';
import { applicationsCommit, resumeDraft, sampleResumeContent } from '@/fixtures/resume';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export type Outcome = 'none' | 'responded' | 'interview' | 'offer' | 'rejected' | 'hired' | 'withdrawn';

export interface ApplicationRow {
  id: string;
  company: string;
  role: string;
  status: string;
  outcome: Outcome;
  opened_at: string | null;
  questions: number;
  created_at: string;
}

interface OutcomeRow { from_outcome: Outcome; to_outcome: Outcome; note: string; created_at: string }

export interface ApplicationDetail extends ApplicationRow { outcomes: OutcomeRow[] }

export interface LoopOwner {
  request: APIRequestContext;
  csrf: string;
  apiToken: string;
  sid: string;
  handle: string;
  email: string;
  password: string;
  sourceID: string;
  jobs: FetchedJobView[];
}

export interface Committed {
  applicationID: string;
  codeID: string;
  code: string;
  job: FetchedJobView;
}

// setupLoopOwner —— a fresh instance, its owner signed in on both faces, one greenhouse source
// fetched from the board mock (its jobs kept for drafting).
export async function setupLoopOwner(playwright: Playwright, handle: string): Promise<LoopOwner> {
  resetInstance();
  const request = await playwright.request.newContext();
  const email = `${handle}@example.com`;
  const password = 'correct-horse-battery-staple';
  await claim(request, findSetupToken(), { email, password, handle, fullName: `${handle} Owner` });
  const { csrf } = await loginAPI(request, email, password);
  const apiToken = await createAPIToken(request, csrf, `${handle}-loop`);
  const sid = await initMCP(request, apiToken);
  const source = await jobsRegisterSource(request, apiToken, sid, {
    kind: 'greenhouse', label: 'Airbnb', config: { company: 'airbnb' },
  });
  const fetched = await jobsFetchNew(request, apiToken, sid, source.id);
  return { request, csrf, apiToken, sid, handle, email, password, sourceID: source.id, jobs: fetched.jobs };
}

// commitApplication —— draft the n-th fetched job and commit it: one application, one fresh code.
export async function commitApplication(o: LoopOwner, n = 0): Promise<Committed> {
  const job = o.jobs[n];
  if (!job) throw new Error(`no fetched job #${n}`);
  const drafted = await resumeDraft(o.request, o.apiToken, o.sid, job.cache_id, sampleResumeContent());
  const c = await applicationsCommit(o.request, o.apiToken, o.sid, drafted.view.draft_id);
  return { applicationID: c.view.application_id, codeID: c.view.access_code_id, code: c.view.access_code, job };
}

async function adminJSON<T>(o: LoopOwner, method: 'get' | 'post', path: string, data?: unknown): Promise<T> {
  const res = await o.request[method](`${BACKEND}/api/admin${path}`, {
    headers: { 'X-Csrftoken': o.csrf }, ...(data === undefined ? {} : { data: data as object }),
  });
  if (!res.ok()) throw new Error(`admin ${method.toUpperCase()} ${path}: ${res.status()} ${await res.text()}`);
  return await res.json() as T;
}

async function listApplications(o: LoopOwner): Promise<ApplicationRow[]> {
  return (await adminJSON<{ items: ApplicationRow[] }>(o, 'get', '/applications/?limit=200')).items;
}

export async function applicationRow(o: LoopOwner, id: string): Promise<ApplicationRow> {
  const row = (await listApplications(o)).find((a) => a.id === id);
  if (!row) throw new Error(`application ${id} is not in the list`);
  return row;
}

export function applicationDetail(o: LoopOwner, id: string): Promise<ApplicationDetail> {
  return adminJSON<ApplicationDetail>(o, 'get', `/applications/${id}`);
}

export function setOutcomeAdmin(o: LoopOwner, id: string, outcome: Outcome, note = ''): Promise<ApplicationRow> {
  return adminJSON<ApplicationRow>(o, 'post', `/applications/${id}/outcome`, { outcome, note });
}

export interface UpdatedOutcome extends ApplicationRow { bound?: { embeds: string[]; microsites: string[] } }

export function updateOutcome(o: LoopOwner, id: string, outcome: Outcome, note = ''): Promise<UpdatedOutcome> {
  return callTool<UpdatedOutcome>(o.request, o.apiToken, o.sid, 'applications.update_outcome',
    { application_id: id, outcome, note });
}
