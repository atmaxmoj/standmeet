import { z } from 'zod';

const ItemsWrapper = z.object({ items: z.array(z.unknown()).optional() });

export async function fetchItemCount(url: string): Promise<number> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return 0;
  const raw: unknown = await res.json();
  if (Array.isArray(raw)) return raw.length;
  const parsed = ItemsWrapper.safeParse(raw);
  return parsed.success ? (parsed.data.items ?? []).length : 0;
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
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return [];
  const raw: unknown = await res.json();
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
