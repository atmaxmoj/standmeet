// use-admin-dashboard —— fan-out fetch 4 个已有 admin list endpoints,
// 返 KPI 计数。轻量做法（vs 单 aggregator endpoint）：每个列表 < 几百
// 行，浏览器 parallel 起 4 个 fetch + count = 单次刷新够用。
//
// list sizes 长起来再考虑加 `/api/admin/dashboard/stats` 单独 SUM 查询。

import { useEffect, useState } from 'react';

import { z } from 'zod';

export interface DashboardStats {
  rawCount: number;
  rawUnprocessed: number;
  codesLive: number;
  requestsNew: number;
  conversationsCount: number;
  draftsReviewing: number;
  // pulse —— 近 14 天每天(UTC)的 corpus 新增，来自 /stats/growth 的真 series（rot-A1：曾经画的是
  // 硬编码的 MOCK_14D，而这条真数据早就在同一个 endpoint 里，被 schema 丢掉了）。
  pulse: readonly number[];
}

interface State {
  stats: DashboardStats;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATS: DashboardStats = {
  rawCount: 0, rawUnprocessed: 0, codesLive: 0,
  requestsNew: 0, conversationsCount: 0, draftsReviewing: 0, pulse: [],
};

// Counts come from the real COUNT(*) growth endpoint, NOT a paginated list length (F-L-4):
// /api/admin/corpus/raw caps at defaultCorpusLimit=50, so `raw.length` under-counts past one page.
const GrowthSchema = z.object({
  by_tier: z.object({
    raw: z.number(), wiki: z.number(), output: z.number(),
    raw_unprocessed: z.number().optional().default(0),
  }),
  // series —— 近 14 天每天的新增（date_trunc GROUP BY）。之前 schema 没声明它，真数据被丢，
  // 仪表盘改画 MOCK_14D（rot-A1）。现在解析它、喂给 corpus-pulse。
  series: z.array(z.object({ day: z.string(), count: z.number() })).optional().default([]),
});
const CodeRowSchema = z.object({ id: z.string(), status: z.string() });
const RequestRowSchema = z.object({ id: z.string(), status: z.string() });
const ConvRowSchema = z.object({ id: z.string() });
const DraftRowSchema = z.object({ id: z.string(), status: z.string().optional() });

export function useAdminDashboard(): State {
  const [state, setState] = useState<State>({
    stats: EMPTY_STATS, loading: true, error: null,
  });
  useEffect(() => { void load(setState); }, []);
  return state;
}

export interface ActionItem {
  key: string;
  count: number;
  label: string;
  sub: string;
  href: string;
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export function allActionItems(stats: DashboardStats): ActionItem[] {
  return [
    { key: 'requests', count: stats.requestsNew,
      label: `${stats.requestsNew} access ${pluralize(stats.requestsNew, 'request', 'requests')}`,
      sub: 'visitors waiting on a code', href: '/admin/requests' },
    { key: 'raw', count: stats.rawUnprocessed,
      label: `${stats.rawUnprocessed} raw ${pluralize(stats.rawUnprocessed, 'entry', 'entries')} unprocessed`,
      sub: 'promote, edit, or archive', href: '/admin/raw' },
    { key: 'drafts', count: stats.draftsReviewing ?? 0,
      label: 'resume drafts pending',
      sub: 'AI generated · awaiting your review', href: '/admin/drafts' },
  ];
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const [growth, codes, requests, conversations, drafts] = await Promise.all([
      fetchGrowth(),
      fetchList('/api/admin/codes/', z.array(CodeRowSchema)),
      fetchList('/api/admin/access-requests', z.array(RequestRowSchema)),
      fetchList('/api/admin/conversations', z.array(ConvRowSchema)),
      fetchList('/api/admin/drafts/', z.array(DraftRowSchema)),
    ]);
    setState({
      stats: {
        rawCount: growth.by_tier.raw + growth.by_tier.wiki + growth.by_tier.output,
        rawUnprocessed: growth.by_tier.raw_unprocessed,
        codesLive: codes.filter((c) => c.status === 'active').length,
        requestsNew: requests.filter((r) => r.status === 'new'
          || r.status === 'pending').length,
        conversationsCount: conversations.length,
        draftsReviewing: drafts.filter((d) => d.status !== 'sent').length,
        pulse: growth.series.map((d) => d.count),
      },
      loading: false, error: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load dashboard failed';
    setState({ stats: EMPTY_STATS, loading: false, error: msg });
  }
}

const WrappedListSchema = z.object({ items: z.array(z.unknown()).optional() });

async function fetchGrowth(): Promise<z.infer<typeof GrowthSchema>> {
  const res = await fetch('/api/admin/stats/growth', { credentials: 'include' });
  if (!res.ok) throw new Error(`/api/admin/stats/growth: ${res.status}`);
  return GrowthSchema.parse(await res.json());
}

async function fetchList<T>(url: string, schema: z.ZodType<T[]>): Promise<T[]> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const raw: unknown = await res.json();
  const items = Array.isArray(raw) ? raw : (WrappedListSchema.safeParse(raw).success ? WrappedListSchema.parse(raw).items ?? [] : []);
  return schema.parse(items);
}
