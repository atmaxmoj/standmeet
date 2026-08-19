// jobs.ts —— MCP jobs.* tool wrappers + external-mock admin helpers.
// Spec calls these to register sources, fetch, dedup, discard, etc.
//
// The MCP tool surface mirrors backend/internal/mcp/jobs_tools.go.

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

// 导出：有的守卫要**先问替身自己发了什么**，再判产品有没有把它处理干净。
// 那种前置条件不落在替身的真实载荷上的话，fixture 一被"清洗"守卫就静默失效。
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
// SourceFailureView —— 某个源没抓成。跟 jobs 一起回，**不是**换掉 jobs：
// 一个源的错凭据不该把其它源抓到的东西扔掉（F-E-6）。
interface SourceFailureView {
  source_id: string;
  label: string;
  kind: string;
  reason: string;
}
// SourceTallyView —— 一个源这一趟的账。没有它，一次取数的结果读不出发生了什么：
// 「HN 回了 1 条」在回执里跟「取数一路失败被静默跳过」长得一模一样（F-E-19）。
interface SourceTallyView {
  source_id: string;
  label: string;
  kind: string;
  seen: number;
  pooled: number;
  duplicate: number;
  // 逐条取的源才有：上游一共多少 / 我们看了多少 / 按原因跳过多少 / 是否截断。
  available?: number;
  read?: number;
  skipped?: Record<string, number>;
  truncated?: boolean;
}
export interface JobsFetchResp {
  jobs: FetchedJobView[];
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

