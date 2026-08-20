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
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import { ago } from '@/lib/ui/format-time';

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
  client_ip: string;
  turns: number;
  private_hits: number;
  transcript?: ConvTurn[];
}

export interface TitledRef {
  id: string;
  title: string;
}

// CITED_GENRES —— 一条答复可以引用的四种体裁。**一处列举**：后端四个都发
// （`conversations_shape.go` 的 messageOut），而这边曾经只读两个，于是 owner 引用了
// 6 条 subjectivity 的那一轮在逐字稿上一行引用都没有（F-A-39）。
// 加第五种体裁时改这一行，其余地方跟着走。
export const CITED_GENRES = ['output', 'wiki', 'subjectivity', 'writing'] as const;
export type CitedGenre = (typeof CITED_GENRES)[number];

// CONV_ROLES —— 逐字稿里的三种行。`event` **不是谁说的话** —— 它是这段对话里发生过的
// 一件事（访客在卡上取消了会）。以前这里只有两种，而映射是「不是 visitor 就当 assistant」，
// 于是这样一行会被贴上 `AI` 的标签：owner 读到的是「AI 说它取消了」，而 AI 从没说过
// （F-B-9 / [[collapsed-error-class-kills-its-own-branch]]）。
export type ConvRole = 'visitor' | 'assistant' | 'event';

export interface ConvTranscriptMessage {
  id: string;
  role: ConvRole;
  body: string;
  created_at: string;
  // cited —— 每种体裁被引用的 id。空数组 = 这一轮没引这一类。
  cited: Record<CitedGenre, readonly string[]>;
}

// GhostLog —— H.13.e: 一行 shown 日志。owner 在详情页看到这条
// 让 visitor 看到了什么 ghost text、是否按了 Tab 接受。
export interface GhostLog {
  id: string;
  ghost_text: string;
  source: 'initial' | 'policy';
  shown_at: string;
  accepted: boolean;
  accepted_at: string | null;
}

export interface ConvTranscript {
  conversationID: string;
  loading: boolean;
  error: string | null;
  messages: ConvTranscriptMessage[];
  // id → title 索引，前端按 cited[genre][i] 找 title 渲染 "cited: <title>"。
  // 四种体裁各一份，跟 CITED_GENRES 同一套名字。
  refs: Record<CitedGenre, Record<string, string>>;
  // grounding —— 塑造了这段对话、但没 opt-in 的 subjectivity 笔记标题(F-A-27)。
  // 按整段对话给,不按 message:owner 要判的是「哪几条在起作用」。
  grounding: string[];
  ghosts: GhostLog[];
}

const TitledRefSchema = z.object({ id: z.string(), title: z.string() });

// citedIDs —— Go 的 nil slice 编码成 `null`，所以是 nullish 而不是 optional
// （[[zod-unknown-is-not-optional]] 那一族：`.optional()` 接不住 null，整份 parse 会挂）。
const citedIDs = z.array(z.string()).nullish().transform((v) => v ?? []);

const ConvMessageSchema = z.object({
  id: z.string(), role: z.string(), body: z.string(), created_at: z.string(),
  cited_wiki_ids: citedIDs, cited_output_ids: citedIDs,
  cited_subjectivity_ids: citedIDs, cited_writing_ids: citedIDs,
});

const GhostLogSchema = z.object({
  id: z.string(),
  ghost_text: z.string(),
  source: z.enum(['initial', 'policy']),
  shown_at: z.string(),
  accepted: z.boolean(),
  accepted_at: z.string().optional(),
});

const ConvTranscriptRespSchema = z.object({
  conversation: ConversationSummarySchema,
  messages: z.array(ConvMessageSchema),
  wiki_refs: z.array(TitledRefSchema).optional(),
  output_refs: z.array(TitledRefSchema).optional(),
  // 后端一直在发这两份（`transcriptOut`），这边曾经不读 —— F-A-39 就是那半边。
  subjectivity_refs: z.array(TitledRefSchema).optional(),
  writing_refs: z.array(TitledRefSchema).optional(),
  // grounding_refs —— 没 opt-in 的 subjectivity,后端只给 title/path(无正文,F-A-27)。
  grounding_refs: z.array(TitledRefSchema).optional(),
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
        messages: [], refs: emptyRefs(), grounding: [], ghosts: [],
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
  const r = useResource(conversationsStore);
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
      messages: data.messages.map(toTranscriptMessage),
      refs: {
        wiki: indexRefs(data.wiki_refs),
        output: indexRefs(data.output_refs),
        subjectivity: indexRefs(data.subjectivity_refs),
        writing: indexRefs(data.writing_refs),
      },
      grounding: (data.grounding_refs ?? []).map((r) => r.title),
      ghosts: toGhostLogs(data.ghosts),
    });
  } catch (e) {
    setTranscript({
      conversationID: id,
      loading: false,
      error: e instanceof Error ? e.message : 'load failed',
      messages: [],
      refs: emptyRefs(),
      grounding: [],
      ghosts: [],
    });
  }
}

// convRole —— 后端的 role 是裸字符串（`messages.role` 无 CHECK）。三种认识的各归各位，
// 其余一律当 assistant —— 兜底还在，但 `event` 不再被兜进去。
function convRole(raw: string): ConvRole {
  return raw === 'visitor' || raw === 'event' ? raw : 'assistant';
}

function toTranscriptMessage(m: z.infer<typeof ConvMessageSchema>): ConvTranscriptMessage {
  return {
    id: m.id,
    role: convRole(m.role),
    body: m.body,
    created_at: m.created_at,
    cited: {
      wiki: m.cited_wiki_ids,
      output: m.cited_output_ids,
      subjectivity: m.cited_subjectivity_ids,
      writing: m.cited_writing_ids,
    },
  };
}

// emptyRefs —— 四种体裁各一份空索引。加载中/出错时用它 —— 少一份就是又一个
// 「这一类在这一面上不存在」。
export function emptyRefs(): Record<CitedGenre, Record<string, string>> {
  return { wiki: {}, output: {}, subjectivity: {}, writing: {} };
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
    client_ip: s.client_ip || '—',
    turns: s.turns,
    private_hits: s.private_hits ?? (s.hit_private ? 1 : 0),
  };
}

// 这个函数叫 formatRelative，返回的却是 `toLocaleString()` —— 一个绝对时间
// （[[names-that-lie]]）。会话列表是扫新鲜度的地方，所以它现在真的是相对时间了（UX-46）。
function formatRelative(iso: string): string {
  return ago(iso);
}
