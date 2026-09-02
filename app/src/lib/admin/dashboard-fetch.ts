// dashboard-fetch —— the dashboard's two GETs. **Throw, don't swallow**: the
// caller decides how to reflect the failure (guide §2).
//
// These two helpers used to fold failure into an empty value (`if (!res.ok)
// return 0` / `return []`), so a 500 on the dashboard would render as a
// confident "0 sent" and "no conversations yet" — both **statements of
// fact**, when the fact right now is "unknown". The caller never even got
// the chance to catch: it never received an error at all. Same family as
// F-A-13, and hidden deeper.
import { z } from 'zod';

import { APIError } from '@/lib/api/api-error';

const ItemsWrapper = z.object({ items: z.array(z.unknown()).optional() });

// okJSON —— a non-2xx throws APIError (401 gets routed to sign-in by useReportError, the rest go to the caller).
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
  // Failing to parse is not 0 either: a shape change is a real incident, don't fold it into a number that looks normal.
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
