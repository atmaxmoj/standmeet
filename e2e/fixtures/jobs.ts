// jobs.ts —— MCP jobs.* tool wrappers + external-mock admin helpers.
// Spec calls these to register sources, fetch, dedup, discard, etc.
//
// The MCP tool surface mirrors backend/internal/mcp/jobs_tools.go.

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

// Exported: some guards need to **ask the mock what it actually emitted first**,
// then judge whether the product processed it cleanly. If that precondition
// doesn't rest on the mock's real payload, the guard silently fails the moment
// the fixture is "cleaned".
export const MOCK_BASE = process.env['JOB_BOARD_MOCK_URL'] ?? 'http://localhost:9000';

export interface JobSourceView {
  id: string;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  created_at: string;
  last_fetched_at?: string;
}

export interface FetchedJobView {
  cache_id: string;
  source_id: string;
  source_kind: string;
  external_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  body_text?: string;
  tags: string[];
  published_at?: string;
}

export interface JobsListResp { sources: JobSourceView[] }
// SourceFailureView —— a source that failed to fetch. Returned alongside jobs,
// **not** in place of them: one source's bad credentials shouldn't throw away what
// the other sources fetched (F-E-6).
interface SourceFailureView {
  source_id: string;
  label: string;
  kind: string;
  reason: string;
}
// SourceTallyView —— one source's tally for this run. Without it, a fetch result
// can't tell you what happened: "HN returned 1" looks identical in the receipt to
// "the fetch failed all the way and was silently skipped" (F-E-19).
interface SourceTallyView {
  source_id: string;
  label: string;
  kind: string;
  seen: number;
  pooled: number;
  duplicate: number;
  // Only for sources fetched item-by-item: how many upstream in total / how many
  // we looked at / how many skipped by reason / whether truncated.
  available?: number;
  read?: number;
  skipped?: Record<string, number>;
  truncated?: boolean;
}
// PoolRowView —— one row in the fetch_new receipt. **No body_text** (that's
// jobs.show's job), plus two extras: how much longer this one lives, and whether
// it entered the pool only on this run.
interface PoolRowView extends Omit<FetchedJobView, 'body_text'> {
  ttl_remaining_seconds: number;
  new: boolean;
}
export interface JobsFetchResp {
  jobs: PoolRowView[];
  failed_sources?: SourceFailureView[];
  sources?: SourceTallyView[];
  cross_source_dropped?: number;
}
export interface OkResp { ok: boolean }

export async function jobsRegisterSource(
  request: APIRequestContext, bearer: string, sid: string,
  args: { kind: string; label: string; config?: Record<string, unknown> },
): Promise<JobSourceView> {
  return callTool<JobSourceView>(request, bearer, sid, 'jobs.register_source', {
    kind: args.kind, label: args.label, config: args.config ?? {},
  });
}

export async function jobsListSources(
  request: APIRequestContext, bearer: string, sid: string,
): Promise<JobsListResp> {
  return callTool<JobsListResp>(request, bearer, sid, 'jobs.list_sources', {});
}

export async function jobsFetchNew(
  request: APIRequestContext, bearer: string, sid: string,
  sourceID?: string, sinceHours?: number,
): Promise<JobsFetchResp> {
  const args: Record<string, unknown> = {};
  if (sourceID) args['source_id'] = sourceID;
  if (sinceHours !== undefined) args['since_hours'] = sinceHours;
  let resp = await callTool<JobsFetchResp | FetchReceipt>(request, bearer, sid, 'jobs.fetch_new', args);
  // Timing only: a fetch that outlasts the server's 20 s wait answers with a receipt; the same
  // result then comes from jobs.fetch_result once every source's job is done.
  const deadline = Date.now() + FETCH_RESULT_BUDGET_MS;
  while (isReceipt(resp) && Date.now() < deadline) {
    await new Promise((r) => { setTimeout(r, FETCH_RESULT_POLL_MS); });
    const more: Record<string, unknown> = { job_ids: resp.job_ids };
    if (sinceHours !== undefined) more['since_hours'] = sinceHours;
    resp = await callTool<JobsFetchResp | FetchReceipt>(request, bearer, sid, 'jobs.fetch_result', more);
  }
  if (isReceipt(resp)) throw new Error(`jobs.fetch_new still pending after ${FETCH_RESULT_BUDGET_MS} ms`);
  return resp;
}

// FetchReceipt —— jobs.fetch_new's answer while its source jobs are still running.
interface FetchReceipt { job_ids: number[]; pending: true }

const FETCH_RESULT_POLL_MS = 1_000;
const FETCH_RESULT_BUDGET_MS = 120_000;

function isReceipt(r: JobsFetchResp | FetchReceipt): r is FetchReceipt {
  return 'pending' in r && r.pending;
}

export async function jobsShow(
  request: APIRequestContext, bearer: string, sid: string, cacheID: string,
): Promise<FetchedJobView> {
  return callTool<FetchedJobView>(request, bearer, sid, 'jobs.show', { cache_id: cacheID });
}

export async function jobsDiscard(
  request: APIRequestContext, bearer: string, sid: string, cacheID: string,
): Promise<OkResp> {
  return callTool<OkResp>(request, bearer, sid, 'jobs.discard', { cache_id: cacheID });
}

export async function jobsUnregisterSource(
  request: APIRequestContext, bearer: string, sid: string, sourceID: string,
): Promise<OkResp> {
  return callTool<OkResp>(request, bearer, sid, 'jobs.unregister_source', {
    source_id: sourceID,
  });
}

// ── external-mock admin helpers ────────────────────────────────────────

/** Tell the mock to serve "day 2" responses for a given kind — drops the
 *  first 2 day1 entries and appends synthetic ones with stable ids
 *  `mockday2-1` / `mockday2-2`. */
export async function mockSetDay(
  request: APIRequestContext, kind: string, day: 1 | 2,
): Promise<void> {
  const res = await request.post(`${MOCK_BASE}/__mock/set_day?kind=${kind}&day=${day}`);
  if (!res.ok()) throw new Error(`mock set_day ${kind}=${day} failed: ${res.status()}`);
}

/** A slow upstream: every mock request whose path starts with `prefix` is answered `ms` later
 *  (0 clears it; the mock's reset clears all). */
export async function mockSetDelay(
  request: APIRequestContext, prefix: string, ms: number,
): Promise<void> {
  const res = await request.post(`${MOCK_BASE}/__mock/set_delay?prefix=${prefix}&ms=${ms}`);
  if (!res.ok()) throw new Error(`mock set_delay ${prefix}=${ms} failed: ${res.status()}`);
}

// Synthetic day-2 external_id sentinels per source kind. Greenhouse uses
// int64 upstream so synthetic ids are numeric strings (fetcher converts
// via strconv at toDomain time); others use opaque strings.
// MOCK_UNTITLED_DAY2 —— the greenhouse row in day2 that has **no title**. Real job
// boards emit malformed rows; a mock that only emits well-formed data is politer
// than reality, and every defect behind that politeness stays invisible.
export const MOCK_UNTITLED_DAY2 = '999000003';

export const MOCK_SYNTHETIC_DAY2 = {
  greenhouse: ['999000001', '999000002', MOCK_UNTITLED_DAY2],
  lever: ['mockday2-1', 'mockday2-2'],
  ashby: ['mockday2-1', 'mockday2-2'],
  remoteok: ['mockday2-1', 'mockday2-2'],
} as const;

