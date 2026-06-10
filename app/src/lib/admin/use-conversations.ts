// use-conversations —— /admin/conversations 状态。
// GET /api/admin/conversations 列表；点行 → GET /{id} 拿 transcript，写到
// transcript state 让 ConvTranscriptModal 显示。
//
// zustand 重构：list 通过 conversationsStore；transcript 是临时 UI state，
// 单独一个小 store。

'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

import { z } from 'zod';

import { adminAPI, ConversationSummarySchema, type ConversationSummary } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

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
  sentiment: string;
  turns: number;
  private_hits: number;
  transcript?: ConvTurn[];
}

export interface TitledRef {
  id: string;
  title: string;
}

export interface ConvTranscriptMessage {
  id: string;
  role: 'visitor' | 'assistant';
  body: string;
  created_at: string;
  cited_wiki_ids: string[];
  cited_output_ids: string[];
}

// GhostLog —— H.13.e: 一行 shown 日志。owner 在详情页看到这条
// 让 visitor 看到了什么 ghost text、是否按了 Tab 接受。
export interface GhostLog {
  id: string;
  ghost_text: string;
  source: 'initial' | 'followup';
  shown_at: string;
  accepted: boolean;
  accepted_at: string | null;
}

export interface ConvTranscript {
  conversationID: string;
  loading: boolean;
  error: string | null;
  messages: ConvTranscriptMessage[];
  // id → title 索引，前端按 cited_*_ids[i] 找 title 渲染 "cited: <title>"。
  wikiRefs: Record<string, string>;
  outputRefs: Record<string, string>;
  ghosts: GhostLog[];
}

const TitledRefSchema = z.object({ id: z.string(), title: z.string() });

const ConvMessageSchema = z.object({
  id: z.string(), role: z.string(), body: z.string(), created_at: z.string(),
  cited_wiki_ids: z.array(z.string()), cited_output_ids: z.array(z.string()),
});

const GhostLogSchema = z.object({
  id: z.string(),
  ghost_text: z.string(),
  source: z.enum(['initial', 'followup']),
  shown_at: z.string(),
  accepted: z.boolean(),
  accepted_at: z.string().optional(),
});

const ConvTranscriptRespSchema = z.object({
  conversation: ConversationSummarySchema,
  messages: z.array(ConvMessageSchema),
  wiki_refs: z.array(TitledRefSchema).optional(),
  output_refs: z.array(TitledRefSchema).optional(),
  ghosts: z.array(GhostLogSchema).optional(),
});

export type TranscriptBodyState = 'loading' | 'error' | 'empty' | 'list';

export function pickTranscriptState(t: ConvTranscript): TranscriptBodyState {
  if (t.loading) return 'loading';
  if (t.error !== null) return 'error';
  return t.messages.length === 0 ? 'empty' : 'list';
}

export interface ConversationsHook {
  status: ResourceStatus;
  rows: readonly ConvView[];
  error: string | null;
  openId: string | null;
  transcript: ConvTranscript | null;
  openConversation: (id: string) => void;
  closeTranscript: () => void;
}

export const conversationsStore = createResourceStore<ConvView[]>({
  name: 'conversations',
  fetcher: async () => {
    const data = await adminAPI.get('/conversations', z.array(ConversationSummarySchema));
    return data.map(toView);
  },
});

interface TranscriptState {
  openId: string | null;
  transcript: ConvTranscript | null;
  open: (id: string) => void;
  close: () => void;
  set: (t: ConvTranscript) => void;
}

const transcriptStore = create<TranscriptState>((set) => ({
  openId: null,
  transcript: null,
  open: (id) => {
    set({
      openId: id,
      transcript: {
        conversationID: id, loading: true, error: null,
        messages: [], wikiRefs: {}, outputRefs: {}, ghosts: [],
      },
    });
    void loadTranscript(id, (t) => set({ transcript: t }));
  },
  close: () => set({ openId: null, transcript: null }),
  set: (t) => set({ transcript: t }),
}));

// useConversations —— 可选 filterCode 让 ConversationsSection 通过 URL 参数
// `?code=INTRO-001` 只显示该 code 的 conversation；客户端 filter，后端 list
// 全拉（v1 量级 ≤ defaultLimit 200，影响不大）。
export function useConversations(filterCode?: string): ConversationsHook {
  const r = readResource(conversationsStore);
  const openId = transcriptStore((s) => s.openId);
  const transcript = transcriptStore((s) => s.transcript);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  const all = r.data ?? [];
  return {
    status: r.status,
    rows: filterByCode(all, filterCode),
    error: r.error,
    openId,
    transcript,
    openConversation: transcriptStore.getState().open,
    closeTranscript: transcriptStore.getState().close,
  };
}

function filterByCode(rows: readonly ConvView[], code: string | undefined): readonly ConvView[] {
  if (!code) return rows;
  return rows.filter((r) => r.code.toLowerCase() === code.toLowerCase());
}

async function loadTranscript(id: string, setTranscript: (t: ConvTranscript) => void): Promise<void> {
  try {
    const data = await adminAPI.get(`/conversations/${id}`, ConvTranscriptRespSchema);
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
        cited_output_ids: m.cited_output_ids,
      })),
      wikiRefs: indexRefs(data.wiki_refs),
      outputRefs: indexRefs(data.output_refs),
      ghosts: toGhostLogs(data.ghosts),
    });
  } catch (e) {
    setTranscript({
      conversationID: id,
      loading: false,
      error: e instanceof Error ? e.message : 'load failed',
      messages: [],
      wikiRefs: {},
      outputRefs: {},
      ghosts: [],
    });
  }
}

function toGhostLogs(
  raw: z.infer<typeof GhostLogSchema>[] | undefined,
): GhostLog[] {
  return (raw ?? []).map((s) => ({
    id: s.id,
    ghost_text: s.ghost_text,
    source: s.source,
    shown_at: s.shown_at,
    accepted: s.accepted,
    accepted_at: s.accepted_at ?? null,
  }));
}

function indexRefs(refs: TitledRef[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (refs ?? []).forEach((r) => { out[r.id] = r.title; });
  return out;
}

// GhostView —— H.13.e: ConvTranscriptModal 渲一行时用的派生 view。
// 三态映射 (sourceCls / acceptedMark / acceptedAttr) 抽这里让组件层
// complexity 守 ≤ 3。
export interface GhostView {
  sourceCls: string;
  acceptedMark: string;
  acceptedAttr: 'true' | 'false';
}

export function deriveGhostView(log: GhostLog): GhostView {
  const sourceCls = log.source === 'initial'
    ? 'text-(--color-accent)' : 'text-(--color-muted)';
  return {
    sourceCls,
    acceptedMark: log.accepted ? '✓ tab' : '—',
    acceptedAttr: log.accepted ? 'true' : 'false',
  };
}

function toView(s: ConversationSummary): ConvView {
  return {
    id: s.id,
    visitor: s.visitor_name || '(anonymous)',
    last: formatRelative(s.last_at),
    code: s.code_value ?? (s.mode === 'byoai' ? 'byoai' : '—'),
    code_label: s.code_label ?? (s.mode === 'byoai' ? 'BYOAI' : s.mode),
    sentiment: s.sentiment ?? '',
    turns: s.message_count,
    private_hits: s.private_hits ?? (s.hit_private ? 1 : 0),
  };
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t).toLocaleString() : iso;
}
