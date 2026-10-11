// job-ledger.ts —— the owner's seen ledger (job-loop roadmap 4.1 + E8): every posting the owner's
// boards or Job Scout ever showed, keyed on the canonical URL and on company::title::location.
//
// Contract (the specs that use this fixture hold the backend to it):
//   MCP (owner):
//     jobs.record {postings: [{title, company, url, location?, body_text?, source?}]}
//       → {results: [{job_seen_id, new, first_seen_at, status}]}, in input order. A posting
//       matching a ledger row on either key is not new; the server dedups (8.1.a).
//     jobs.annotate {job_seen_id, score?, reason?, deductions?: [{points, why}], cited_notes?: [],
//       flags?: [], interview_reports?: []} → the ledger row (4.1.d, 8.2.a).
//     jobs.history {from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', status?, cursor?, limit?}
//       → the shared page {items: LedgerRow[], next_cursor?}, newest first_seen_at first (8.3.a).
//       from/to are inclusive UTC days.
//     jobs.mark_company {company, mark: 'do_not_apply' | 'none', note?} → {company, mark} (4.1.e).
//   Pool rows (jobs.fetch_new, jobs.show) carry `job_seen_id`, and `flags` when a mark applies.
//   resume.draft accepts `job_seen_id` in place of `cache_id` (8.4.a), and `override: true` to draft
//   for a do_not_apply company (4.1.e). applications.commit marks the row applied (8.4.b).
//   Statuses: seen | discarded | applied. jobs.discard marks the row discarded (4.1.c).

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

export interface Posting {
  title: string;
  company: string;
  url: string;
  location?: string;
  body_text?: string;
  source?: string;
}

export interface Recorded {
  job_seen_id: string;
  new: boolean;
  first_seen_at: string;
  status: string;
}

export interface Annotations {
  score?: number;
  reason?: string;
  deductions?: { points: number; why: string }[];
  cited_notes?: string[];
  flags?: string[];
  interview_reports?: string[];
}

export interface LedgerRow extends Annotations {
  job_seen_id: string;
  first_seen_at: string;
  last_seen_at: string;
  status: 'seen' | 'discarded' | 'applied';
  title: string;
  company: string;
  url: string;
  source: string;
  application_id: string | null;
  /** Times the company posted this job again under a new URL (roadmap 1.5.b). */
  reposts: number;
}

export interface LedgerPage { items: LedgerRow[]; next_cursor?: string }

interface Ctx { request: APIRequestContext; apiToken: string; sid: string }

export async function jobsRecord(c: Ctx, postings: Posting[]): Promise<Recorded[]> {
  return (await callTool<{ results: Recorded[] }>(c.request, c.apiToken, c.sid, 'jobs.record', { postings })).results;
}

export function jobsAnnotate(c: Ctx, jobSeenID: string, a: Annotations): Promise<LedgerRow> {
  return callTool<LedgerRow>(c.request, c.apiToken, c.sid, 'jobs.annotate', { job_seen_id: jobSeenID, ...a });
}

export function jobsHistory(c: Ctx, args: Record<string, unknown> = {}): Promise<LedgerPage> {
  return callTool<LedgerPage>(c.request, c.apiToken, c.sid, 'jobs.history', args);
}

export function jobsMarkCompany(
  c: Ctx, company: string, mark: 'do_not_apply' | 'none', note = '',
): Promise<{ company: string; mark: string }> {
  return callTool(c.request, c.apiToken, c.sid, 'jobs.mark_company', { company, mark, note });
}

// allHistory —— every page, following next_cursor.
export async function allHistory(c: Ctx, args: Record<string, unknown> = {}): Promise<LedgerRow[]> {
  const out: LedgerRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await jobsHistory(c, { ...args, ...(cursor ? { cursor } : {}) });
    out.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}
