// use-admin-listings —— /admin/listings 的 fetch hook(#50)。读 Redis 1d-TTL
// 池子里现存(未 commit)的 FetchedJob，admin 只读。源走 MCP jobs.fetch_new；
// 这里只显示。池子 ephemeral：过期或 fetch 太久没跑 → 空态。

import { useEffect, useState } from 'react';

import { z } from 'zod';

import { safeJson } from '@/lib/api/typed-json';

const AdminListingRowSchema = z.object({
  cache_id: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string(),
  source_kind: z.string(),
  published_at: z.string(),
  tags: z.array(z.string()),
});
export type AdminListingRow = z.infer<typeof AdminListingRowSchema>;

const ENDPOINT = '/api/admin/listings/';

interface State {
  rows: AdminListingRow[];
  loading: boolean;
  error: string | null;
}

export function useAdminListings(): State {
  const [state, setState] = useState<State>({ rows: [], loading: true, error: null });
  useEffect(() => { void load(setState); }, []);
  return state;
}

export type ListingsBodyState = 'loading' | 'error' | 'empty' | 'list';

// pickListingsBodyState —— component 用,避免 .tsx 里 if-ladder 触发 no-if/cyclo。
export function pickListingsBodyState(
  count: number, loading: boolean, error: string | null,
): ListingsBodyState {
  if (loading) return 'loading';
  if (error !== null) return 'error';
  return count === 0 ? 'empty' : 'list';
}

async function load(setState: (s: State) => void): Promise<void> {
  try {
    const res = await fetch(ENDPOINT, { credentials: 'include' });
    if (!res.ok) throw new Error(`list listings: ${res.status}`);
    const rows = await safeJson(res, z.array(AdminListingRowSchema));
    setState({ rows, loading: false, error: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'load listings failed';
    setState({ rows: [], loading: false, error: msg });
  }
}
