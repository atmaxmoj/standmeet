// use-conversations —— /admin/conversations 状态。
// GET /api/admin/conversations 列表；点行 → GET /{id} 拿 transcript，写到
// transcript state 让 ConvTranscriptModal 显示。

'use client';

import { useCallback, useEffect, useState } from 'react';

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

export interface ConvTranscriptMessage {
  id: string;
  role: 'visitor' | 'assistant';
  body: string;
  created_at: string;
  cited_wiki_ids: string[];
}

export interface ConvTranscript {
  conversationID: string;
  loading: boolean;
  error: string | null;
  messages: ConvTranscriptMessage[];
}

interface ConvTranscriptResp {
  conversation: ConversationSummary;
  messages: Array<{
    id: string;
    role: string;
    body: string;
    created_at: string;
    cited_wiki_ids: string[];
  }>;
}

export type TranscriptBodyState = 'loading' | 'error' | 'empty' | 'list';

export function pickTranscriptState(t: ConvTranscript): TranscriptBodyState {
  if (t.loading) return 'loading';
  if (t.error !== null) return 'error';
  return t.messages.length === 0 ? 'empty' : 'list';
}

export interface ConversationsHook {
  rows: readonly ConvView[];
  loading: boolean;
  error: string | null;
  openId: string | null;
  transcript: ConvTranscript | null;
  openConversation: (id: string) => void;
  closeTranscript: () => void;
}

export function useConversations(): ConversationsHook {
  const [rows, setRows] = useState<ConvView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ConvTranscript | null>(null);

  useEffect(() => {
    let cancelled = false;
    void initialLoad(cancelled, setRows, setLoading, setError);
    return () => { cancelled = true; };
  }, []);

  const openConversation = useCallback((id: string): void => {
    setOpenId(id);
    setTranscript({ conversationID: id, loading: true, error: null, messages: [] });
    void loadTranscript(id, setTranscript);
  }, []);

  const closeTranscript = useCallback((): void => {
    setOpenId(null);
    setTranscript(null);
  }, []);

  return { rows, loading, error, openId, transcript, openConversation, closeTranscript };
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

async function loadTranscript(
  id: string, setTranscript: (t: ConvTranscript) => void,
): Promise<void> {
  try {
    const data = await adminAPI.get<ConvTranscriptResp>(`/conversations/${id}`);
    setTranscript({
      conversationID: id,
      loading: false,
      error: null,
      messages: data.messages.map((m) => ({
        id: m.id,
        role: m.role === 'visitor' ? 'visitor' : 'assistant',
        body: m.body,
        created_at: m.created_at,
        cited_wiki_ids: m.cited_wiki_ids,
      })),
    });
  } catch (e) {
    setTranscript({
      conversationID: id,
      loading: false,
      error: e instanceof Error ? e.message : 'load failed',
      messages: [],
    });
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
