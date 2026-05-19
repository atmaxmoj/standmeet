// use-conversations —— /admin/conversations 状态。
// GET /api/admin/conversations 已接通；hook 返回的 rows 用 ConversationSummary
// 映射到 UI ConvView。展开 transcript 是后续 modal 的事，这里只列表。

import { useEffect, useState } from 'react';

import { adminAPI, type ConversationSummary } from '@/lib/api/admin';

export interface ConvTurn {
  who: 'visitor' | 'ai';
  text: string;
  flagged?: boolean;
}

export interface ConvView {
  id: string;
  visitor: string;
  last: string;
  code: string;
  code_label: string;
  turns: number;
  private_hits: number;
  transcript?: ConvTurn[];
}

export interface ConversationsHook {
  rows: readonly ConvView[];
  loading: boolean;
  error: string | null;
  openId: string | null;
  toggleOpen: (id: string) => void;
}

export function useConversations(): ConversationsHook {
  const [rows, setRows] = useState<ConvView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setRows, setLoading, setError);
    return () => { cancelled = true; };
  }, []);

  const toggleOpen = (id: string) => setOpenId((cur) => cur === id ? null : id);
  return { rows, loading, error, openId, toggleOpen };
}

async function initialLoad(
  cancelled: boolean,
  setRows: (rs: ConvView[]) => void,
  setLoading: (b: boolean) => void,
  setErr: (m: string | null) => void,
): Promise<void> {
  try {
    const data = await adminAPI.get<ConversationSummary[]>('/conversations');
    if (cancelled) return;
    setRows(data.map(toView));
  } catch (e) {
    cancelled || setErr(e instanceof Error ? e.message : 'load failed');
  } finally {
    cancelled || setLoading(false);
  }
}

function toView(s: ConversationSummary): ConvView {
  return {
    id: s.id,
    visitor: s.visitor_name || '(anonymous)',
    last: formatRelative(s.last_at),
    code: s.code_value ?? (s.tier === 'byoai' ? 'byoai' : '—'),
    code_label: s.code_label ?? (s.tier === 'byoai' ? 'BYOAI' : s.tier),
    turns: s.message_count,
    private_hits: s.hit_private ? 1 : 0,
  };
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso;
}
