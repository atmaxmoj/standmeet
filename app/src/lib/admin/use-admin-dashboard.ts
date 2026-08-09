// use-admin-dashboard —— fan-out fetch 4 个已有 admin list endpoints,
// 返 KPI 计数。轻量做法（vs 单 aggregator endpoint）：每个列表 < 几百
// 行，浏览器 parallel 起 4 个 fetch + count = 单次刷新够用。
//
// list sizes 长起来再考虑加 `/api/admin/dashboard/stats` 单独 SUM 查询。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { pendingRequests } from '@/lib/admin/access-request-status';

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
  // pulseDays —— 与 pulse 对齐的日期(每点的 x 标签)，让 sparkline 的 hover tooltip 显示
  // 「日期 · 值」，owner 读得出具体哪天多少条（F-C-5：一条读不出数字的图等于只有形状）。
  pulseDays: readonly string[];
  // aiProviderUsable —— 这台实例还答得了访客吗(本子里至少有一条配了 key)。
  // 答不了的时候访客收到 503,而 owner 那边曾经**没有任何提示** —— 表单空着,看起来像"还没配过",
  // 于是一个接一个的访客被赶走而他毫不知情(F-A-24)。这一条就是那个提示的数据源。
  aiProviderUsable: boolean;
}

interface State {
  stats: DashboardStats;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATS: DashboardStats = {
  rawCount: 0, rawUnprocessed: 0, codesLive: 0,
  requestsNew: 0, conversationsCount: 0, draftsReviewing: 0, pulse: [], pulseDays: [],
  // 还没拉到的时候不许喊狼来了:先当它是好的,拉回来再说。
  aiProviderUsable: true,
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
// key_configured 是"这条能不能真去调"的唯一凭据 —— 一条没有 key 的 provider 行答不了访客。
const ProviderRowSchema = z.object({ id: z.string(), key_configured: z.boolean() });

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
    // 排第一,因为它一条就让整台实例答不了任何人:访客发第一句话就收到 503。
    // 这一行存在的意义就是**打破沉默** —— F-A-24 里 owner 唯一能察觉的方式是自己去当访客。
    { key: 'ai', count: stats.aiProviderUsable ? 0 : 1,
      label: 'no usable AI provider',
      sub: 'visitors are being turned away — set a key under api · mcp',
      href: '/admin/api-mcp' },
    { key: 'requests', count: stats.requestsNew,
      label: `${stats.requestsNew} access ${pluralize(stats.requestsNew, 'request', 'requests')}`,
      sub: 'visitors waiting on a code', href: '/admin/requests' },
    // F-C-6: 原文案 "promote, edit, or archive" 撒谎 —— raw 没有 archive 功能;且把 raw 框成
    // 待办队列。raw 是发酵池:放着不动是合法状态,文案要说出来。
    { key: 'raw', count: stats.rawUnprocessed,
      label: `${stats.rawUnprocessed} raw ${pluralize(stats.rawUnprocessed, 'entry', 'entries')} unprocessed`,
      sub: 'promote, edit, or let them ferment', href: '/admin/raw' },
    { key: 'drafts', count: stats.draftsReviewing ?? 0,
      label: 'resume drafts pending',
      sub: 'AI generated · awaiting your review', href: '/admin/drafts' },
  ];
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const [growth, codes, requests, conversations, drafts, providers] = await Promise.all([
      fetchGrowth(),
      fetchList('/api/admin/codes/', z.array(CodeRowSchema)),
      fetchList('/api/admin/access-requests', z.array(RequestRowSchema)),
      fetchList('/api/admin/conversations', z.array(ConvRowSchema)),
      fetchList('/api/admin/drafts/', z.array(DraftRowSchema)),
      fetchList('/api/admin/providers/', z.array(ProviderRowSchema)),
    ]);
    setState({
      stats: {
        rawCount: growth.by_tier.raw + growth.by_tier.wiki + growth.by_tier.output,
        rawUnprocessed: growth.by_tier.raw_unprocessed,
        codesLive: codes.filter((c) => c.status === 'active').length,
        requestsNew: pendingRequests(requests).length,
        conversationsCount: conversations.length,
        draftsReviewing: drafts.filter((d) => d.status !== 'sent').length,
        pulse: growth.series.map((d) => d.count),
        pulseDays: growth.series.map((d) => d.day),
        aiProviderUsable: providers.some((p) => p.key_configured),
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
