// job-ledger.ts —— the owner's seen ledger (job-loop roadmap 4.1 + E8): every posting the owner's
// boards or Job Scout ever showed, keyed on the canonical URL and on company::title::location.
//
// Contract (the specs that use this fixture hold the backend to it):
//   MCP (owner):
//     jobs.record {postings: [{title, company, url, location?, body_text?, source?}]}
//       → {results: [{job_seen_id, new, first_seen_at, status}]}, in input order. A posting
//       matching a ledger row on either key is not new; the server dedups (8.1.a).
//     jobs.annotate {job_seen_id, score?, reason?, deductions?: [{points, why}], cited_notes?: [],
//       flags?: [], interview_reports?: [], brief?} → the ledger row (4.1.d, 8.2.a). brief = the
//       picture of the job in markdown, written before applying; it stays on the applied row.
//       homework = the half for the recruiter's agent (what the owner learned, why they fit); it
//       is refused when it names pay or work authorization. The recruiter reads it with
//       homework_read on the application's own code.
//     jobs.history {from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', status?, cursor?, limit?}
//       → the shared page {items: LedgerRow[], next_cursor?}, newest first_seen_at first (8.3.a).
//       from/to are inclusive UTC days.
//     jobs.mark_company {company, mark: 'do_not_apply' | 'none', note?} → {company, mark} (4.1.e).
//     jobs.interview_packet {job_seen_id} → {fingerprint, body}: a practice interview's input
//       (docs/design/deepinterview-engine.md); fingerprint = sha256 of body's bytes.
//     jobs.add_interview_report {job_seen_id, report} → {job_seen_id, added}: appends to
//       interview_reports; an empty report is refused.
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
  /** The row was assessed once and the assessment has since been cleared (retention). */
  assessed_before?: boolean;
}

export interface Annotations {
  score?: number;
  reason?: string;
  deductions?: { points: number; why: string }[];
  cited_notes?: string[];
  flags?: string[];
  interview_reports?: string[];
  brief?: string;
  homework?: string;
}

/** jobs.annotate's lifecycle arguments (docs/design/job-loop-retention.md). */
export interface AnnotateArgs extends Annotations {
  /** ephemeral puts the row on a 90-day clock; forever takes it off. */
  retention?: 'forever' | 'ephemeral';
  /** Pin: the clock stops while true. */
  keep?: boolean;
  /** Join this bundle's clock instead of starting one. */
  bundle_id?: string;
}

/** A row's lifecycle as jobs.history shows it. */
interface Lifecycle {
  retention: 'forever' | 'ephemeral';
  keep: boolean;
  bundle_id: string | null;
  last_touched_at: string | null;
  expires_at: string | null;
  expiring: boolean;
  cleared_at: string | null;
}

export interface LedgerRow extends Annotations, Lifecycle {
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

export function jobsAnnotate(c: Ctx, jobSeenID: string, a: AnnotateArgs): Promise<LedgerRow> {
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
