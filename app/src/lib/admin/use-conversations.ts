// use-conversations —— state for /admin/conversations.
// GET /api/admin/conversations lists them; clicking a row → GET /{id} fetches
// the transcript, written into transcript state so ConvTranscriptModal can display it.
//
// zustand refactor: the list goes through conversationsStore; transcript is
// transient UI state, kept in its own small store.

'use client';

import { useEffect } from 'react';
import { create } from 'zustand';

import { z } from 'zod';

import { adminAPI, ConversationSummarySchema, type ConversationSummary } from '@/lib/api/admin';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';
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

// CITED_GENRES —— the four genres a reply can cite. **Enumerated in one
// place**: the backend sends all four (`conversations_shape.go`'s
// messageOut), while this side used to read only two, so a turn that cited 6
// subjectivity entries showed not a single citation on the transcript (F-A-39).
// Add a fifth genre by editing this line; everywhere else follows.
export const CITED_GENRES = ['output', 'wiki', 'subjectivity', 'writing'] as const;
export type CitedGenre = (typeof CITED_GENRES)[number];

// CONV_ROLES —— the three kinds of rows in a transcript. `event` is **not
// something said by anyone** — it's something that happened during this
// conversation (the visitor cancelled a booking on a card). There used to be
// only two, mapped as "not visitor, so assistant", so a row like this got
// labeled `AI`: the owner would read it as "the AI said it cancelled", and
// the AI never said any such thing (F-B-9 / [[collapsed-error-class-kills-its-own-branch]]).
export type ConvRole = 'visitor' | 'assistant' | 'event';

export interface ConvTranscriptMessage {
  id: string;
  role: ConvRole;
  body: string;
  created_at: string;
  // cited —— the ids cited for each genre. An empty array = this turn cited nothing from that genre.
  cited: Record<CitedGenre, readonly string[]>;
}

// GhostLog —— H.13.e: one shown log entry. On the detail page, the owner
// sees which ghost text was shown to the visitor and whether they pressed Tab to accept it.
export interface GhostLog {
  id: string;
  ghost_text: string;
  source: 'initial' | 'policy';
  shown_at: string;
  accepted: boolean;
  accepted_at: string | null;
  // count —— how many times this same ghost was shown (see toGhostLogs); 1 for a single showing.
  count: number;
}

export interface ConvTranscript {
  conversationID: string;
  // summary —— who the visitor was / which code, for the downloaded transcript's header. Null
  // until the conversation has loaded.
  summary: ConvView | null;
  loading: boolean;
  error: string | null;
  messages: ConvTranscriptMessage[];
  // An id → title index, the frontend looks up cited[genre][i] to render
  // "cited: <title>". One per genre, using the same names as CITED_GENRES.
  refs: Record<CitedGenre, Record<string, string>>;
  // grounding —— titles of subjectivity notes that shaped this conversation
  // but weren't opted in (F-A-27). Given per whole-conversation, not
  // per-message: what the owner needs to judge is "which entries were in play".
  grounding: string[];
  ghosts: GhostLog[];
}

const TitledRefSchema = z.object({ id: z.string(), title: z.string() });

// citedIDs —— Go's nil slice encodes as `null`, hence nullish rather than
// optional (the [[zod-unknown-is-not-optional]] family: `.optional()` can't accept null, and the whole parse would fail).
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
  // The backend had always been sending these two (`transcriptOut`), this side just never read them — F-A-39 was that half of it.
  subjectivity_refs: z.array(TitledRefSchema).optional(),
  writing_refs: z.array(TitledRefSchema).optional(),
  // grounding_refs —— subjectivity entries not opted in; the backend gives only title/path (no body, F-A-27).
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
  // total —— how many conversations match (the server's count, not the loaded rows).
  total: number | null;
  error: string | null;
  page: PagedState<ConvView>;
  openId: string | null;
  transcript: ConvTranscript | null;
  openConversation: (id: string) => void;
  closeTranscript: () => void;
}

// conversationsPage —— one page at a time, most recent activity first (docs/design/paging.md).
// The ?code= filter is a server param: a filter over loaded pages would miss older ones.
export const conversationsPage = createPagedStore({
  name: 'conversations', path: '/conversations',
  item: ConversationSummarySchema.transform(toView), params: { code: '' },
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
        conversationID: id, summary: null, loading: true, error: null,
        messages: [], refs: emptyRefs(), grounding: [], ghosts: [],
      },
    });
    void loadTranscript(id, (t) => set({ transcript: t }));
  },
  close: () => set({ openId: null, transcript: null }),
  set: (t) => set({ transcript: t }),
}));

// useConversations —— the optional filterCode (the URL's `?code=INTRO-001`) narrows the list
// on the server.
export function useConversations(filterCode?: string): ConversationsHook {
  const page = usePaged(conversationsPage);
  const openId = transcriptStore((s) => s.openId);
  const transcript = transcriptStore((s) => s.transcript);
  const { setParams, params } = page;
  const code = filterCode ?? '';
  useEffect(() => { if (params.code !== code) setParams({ code }); }, [code, params.code, setParams]);
  return {
    status: page.status,
    rows: page.items,
    total: page.total,
    error: page.error,
    page,
    openId,
    transcript,
    openConversation: transcriptStore.getState().open,
    closeTranscript: transcriptStore.getState().close,
  };
}

async function loadTranscript(id: string, setTranscript: (t: ConvTranscript) => void): Promise<void> {
  try {
    const data = await adminAPI.get(`/conversations/${id}`, ConvTranscriptRespSchema);
    setTranscript({
      conversationID: id,
      summary: toView(data.conversation),
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
      summary: null,
      loading: false,
      error: e instanceof Error ? e.message : 'load failed',
      messages: [],
      refs: emptyRefs(),
      grounding: [],
      ghosts: [],
    });
  }
}

// convRole —— the backend's role is a bare string (`messages.role` has no
// CHECK constraint). The three recognized ones each go to their own place,
// everything else falls back to assistant — the fallback still exists, but `event` is no longer caught by it.
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

// emptyRefs —— an empty index for each of the four genres. Used while
// loading/on error — missing one would be one more genre this surface pretends doesn't exist.
export function emptyRefs(): Record<CitedGenre, Record<string, string>> {
  return { wiki: {}, output: {}, subjectivity: {}, writing: {} };
}

// toGhostLogs —— one row per ghost the visitor was shown, not one per page load: the same text
// from the same source is folded into its first showing, with `count` = how many times it was
// shown and `accepted` = accepted on any of them. The owner read six identical lines for one
// ghost (2026-09-28) — the list is for "what was suggested and did it land", and repetition
// belongs in a count.
function toGhostLogs(
  raw: z.infer<typeof GhostLogSchema>[] | undefined,
): GhostLog[] {
  const rows: GhostLog[] = [];
  const byKey = new Map<string, GhostLog>();
  for (const s of raw ?? []) {
    const key = `${s.source}\u0000${s.ghost_text}`;
    const seen = byKey.get(key);
    if (seen !== undefined) {
      foldGhost(seen, s);
      continue;
    }
    const row: GhostLog = {
      id: s.id, ghost_text: s.ghost_text, source: s.source, shown_at: s.shown_at,
      accepted: s.accepted, accepted_at: s.accepted_at ?? null, count: 1,
    };
    byKey.set(key, row);
    rows.push(row);
  }
  return rows;
}

function foldGhost(row: GhostLog, s: z.infer<typeof GhostLogSchema>): void {
  row.count += 1;
  if (s.accepted && !row.accepted) {
    row.accepted = true;
    row.accepted_at = s.accepted_at ?? null;
  }
}

function indexRefs(refs: TitledRef[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  (refs ?? []).forEach((r) => { out[r.id] = r.title; });
  return out;
}

// GhostView —— H.13.e: the derived view used when ConvTranscriptModal
// renders one row. The three-state mapping (sourceCls / acceptedMark /
// acceptedAttr) is pulled out here so the component layer keeps complexity ≤ 3.
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

// This function is called formatRelative, yet it used to return
// `toLocaleString()` — an absolute time ([[names-that-lie]]). The
// conversation list is where freshness gets scanned, so it now genuinely is a relative time (UX-46).
function formatRelative(iso: string): string {
  return ago(iso);
}
