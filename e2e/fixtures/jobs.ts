// jobs.ts —— MCP jobs.* tool wrappers + external-mock admin helpers.
// Spec calls these to register sources, fetch, dedup, discard, etc.
//
// The MCP tool surface mirrors backend/internal/mcp/jobs_tools.go.

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

const MOCK_BASE = process.env['JOB_BOARD_MOCK_URL'] ?? 'http://localhost:9000';

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
// SourceFailureView —— 某个源没抓成。跟 jobs 一起回，**不是**换掉 jobs：
// 一个源的错凭据不该把其它源抓到的东西扔掉（F-E-6）。
interface SourceFailureView {
  source_id: string;
  label: string;
  kind: string;
  reason: string;
}
export interface JobsFetchResp {
  jobs: FetchedJobView[];
  failed_sources?: SourceFailureView[];
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
  sourceID?: string,
): Promise<JobsFetchResp> {
  const args: Record<string, unknown> = {};
  if (sourceID) args['source_id'] = sourceID;
  return callTool<JobsFetchResp>(request, bearer, sid, 'jobs.fetch_new', args);
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

// Synthetic day-2 external_id sentinels per source kind. Greenhouse uses
// int64 upstream so synthetic ids are numeric strings (fetcher converts
// via strconv at toDomain time); others use opaque strings.
export const MOCK_SYNTHETIC_DAY2 = {
  greenhouse: ['999000001', '999000002'],
  lever: ['mockday2-1', 'mockday2-2'],
  ashby: ['mockday2-1', 'mockday2-2'],
  remoteok: ['mockday2-1', 'mockday2-2'],
} as const;

