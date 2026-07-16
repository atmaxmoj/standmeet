// dashboard-fetch —— dashboard 的两个 GET。**抛，不吞**：调用方决定怎么反显（guide §2）。
//
// 这两个帮手原来都把失败折成空值（`if (!res.ok) return 0` / `return []`），于是 dashboard 上一个
// 500 会渲染成一句自信的「0 sent」和一句「no conversations yet」—— 都是**关于事实的陈述**，而事实
// 此刻是「不知道」。调用方连 catch 的机会都没有：它根本没收到错误。F-A-13 的同类，且藏得更深。
import { z } from 'zod';

import { APIError } from '@/lib/api/api-error';

const ItemsWrapper = z.object({ items: z.array(z.unknown()).optional() });

// okJSON —— 非 2xx 抛 APIError（401 会被 useReportError 分流去登录，其余给调用方）。
async function okJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new APIError(res.status, 'dashboard_fetch_failed', 'Couldn’t load this. Reload and retry.');
  }
  return await res.json();
}

export async function fetchItemCount(url: string): Promise<number> {
  const raw: unknown = await okJSON(url);
  if (Array.isArray(raw)) return raw.length;
  const parsed = ItemsWrapper.safeParse(raw);
  // 解不动也不是 0：形状变了是真事故，别折成一个看着正常的数字。
  if (!parsed.success) {
    throw new APIError(200, 'dashboard_bad_shape', 'Couldn’t read this count. Reload and retry.');
  }
  return (parsed.data.items ?? []).length;
}

const RecentRowSchema = z.object({
  id: z.string(),
  visitor_name: z.string().optional().default(''),
  code_label: z.string().nullable().optional(),
  turns: z.number().optional().default(0),
  last_at: z.string().optional().default(''),
});

export interface DashboardRecentRow {
  id: string;
  visitor: string;
  code_label: string;
  turns: number;
  last: string;
  private_hits: number;
}

export async function fetchRecentConversations(url: string, limit: number): Promise<DashboardRecentRow[]> {
  const raw: unknown = await okJSON(url);
  const arr = Array.isArray(raw) ? raw : [];
  return arr.slice(0, limit).map(toRecentRow).filter((x): x is DashboardRecentRow => x !== null);
}

function toRecentRow(x: unknown): DashboardRecentRow | null {
  const p = RecentRowSchema.safeParse(x);
  if (!p.success) return null;
  return {
    id: p.data.id,
    visitor: p.data.visitor_name || '(anonymous)',
    code_label: p.data.code_label ?? '—',
    turns: p.data.turns,
    last: p.data.last_at,
    private_hits: 0,
  };
}
