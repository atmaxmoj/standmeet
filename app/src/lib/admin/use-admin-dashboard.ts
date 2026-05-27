// use-admin-dashboard —— fan-out fetch 4 个已有 admin list endpoints,
// 返 KPI 计数。轻量做法（vs 单 aggregator endpoint）：每个列表 < 几百
// 行，浏览器 parallel 起 4 个 fetch + count = 单次刷新够用。
//
// list sizes 长起来再考虑加 `/api/admin/dashboard/stats` 单独 SUM 查询。

import { useEffect, useState } from 'react';

export interface DashboardStats {
  rawCount: number;
  rawUnprocessed: number;
  codesLive: number;
  requestsNew: number;
  conversationsCount: number;
  draftsReviewing: number;
}

interface State {
  stats: DashboardStats;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATS: DashboardStats = {
  rawCount: 0, rawUnprocessed: 0, codesLive: 0,
  requestsNew: 0, conversationsCount: 0, draftsReviewing: 0,
};

interface RawRow { id: string; promoted_wiki_id?: string | null }
interface CodeRow { id: string; status: string }
interface RequestRow { id: string; status: string }
interface ConvRow { id: string }
interface DraftRow { id: string; status?: string }

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
    const [raw, codes, requests, conversations, drafts] = await Promise.all([
      fetchList<RawRow>('/api/admin/raw'),
      fetchList<CodeRow>('/api/admin/codes/'),
      fetchList<RequestRow>('/api/admin/access-requests'),
      fetchList<ConvRow>('/api/admin/conversations'),
      fetchList<DraftRow>('/api/admin/drafts/'),
    ]);
    setState({
      stats: {
        rawCount: raw.length,
        rawUnprocessed: raw.filter((r) => r.promoted_wiki_id === null
          || r.promoted_wiki_id === undefined).length,
        codesLive: codes.filter((c) => c.status === 'active').length,
        requestsNew: requests.filter((r) => r.status === 'new'
          || r.status === 'pending').length,
        conversationsCount: conversations.length,
        draftsReviewing: drafts.filter((d) => d.status !== 'sent').length,
      },
      loading: false, error: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load dashboard failed';
    setState({ stats: EMPTY_STATS, loading: false, error: msg });
  }
}

async function fetchList<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const body = await res.json() as T[] | { items?: T[] };
  // some endpoints wrap in {items:[]} —— normalize
  return Array.isArray(body) ? body : (body.items ?? []);
}
