// page-session —— PageSession lifecycle: ensureSession fetches
// /sessions once → caches it; reuseStored revives it from localStorage;
// issueByMode splits by public/code/byoai. Split out of use-chat.ts to
// keep the 350-line cap.

'use client';

import type { DocContext } from '@standmeet/agent-core';
import { readBYOAIVaultMeta, type PublicSessionResponse } from '@standmeet/sdk-core';

import {
  issueBYOAISession, issuePublicSession,
  openDocConversation,
} from './api.js';
import { loadStoredSession } from './stored-session.js';
import { useBlockStore } from './block-store.js';
import { useDockButtonsStore } from './dock-buttons-store.js';
import { useGhostsStore } from './ghosts-store.js';
import { useToolSpecsStore } from './tool-specs-store.js';

export type SessionMode = 'public' | 'code' | 'byoai';

// PageSession —— kept internally after ensureSession; carries the
// part_ids + tool_specs used for the pi-pivot. The browser no longer hits
// /sessions repeatedly (the old path did reuseStored on every ask and
// never read part_ids); here first-ask fetches once and holds it for the
// whole session.
export interface PageSession {
  sessionToken: string;
  conversationID: string;
  systemPromptPartIDs: readonly string[];
  persona: string;
}

export interface SessionDeps {
  mode: SessionMode;
  // session —— a session the caller already issued (the owner's self-test of a code, which must
  // not touch the visitor session stored in the owner's browser). Given → used as is.
  session?: PublicSessionResponse;
}

// ensureEffectiveSession —— the main chat uses the session's own main
// conversation; the floating dock (with docContext) lazily resolves its
// own doc conversation on its first question (POST /conversations), then
// caches and reuses it. If resolution fails, falls back to the main
// conversation (doesn't crash, at the cost of not splitting this time).
// This is the core of the multi-conversation model.
export async function ensureEffectiveSession(
  sessionRef: React.MutableRefObject<PageSession | null>,
  docConvRef: React.MutableRefObject<string | null>,
  deps: SessionDeps,
  docContext?: DocContext,
): Promise<PageSession> {
  const sess = await ensureSession(sessionRef, deps);
  if (docContext === undefined) return sess;
  const convID = await resolveDocConv(docConvRef, docContext, sess);
  return { ...sess, conversationID: convID };
}

async function resolveDocConv(
  docConvRef: React.MutableRefObject<string | null>,
  dc: DocContext,
  sess: PageSession,
): Promise<string> {
  if (docConvRef.current === null) {
    const id = await openDocConversation(docKeyOf(dc), sess.sessionToken);
    if (id !== null) docConvRef.current = id;
  }
  return docConvRef.current ?? sess.conversationID;
}

function docKeyOf(dc: DocContext): string {
  return `${dc.genre}/${dc.path}`;
}

export async function ensureSession(
  ref: React.MutableRefObject<PageSession | null>,
  deps: SessionDeps,
): Promise<PageSession> {
  if (ref.current !== null) return ref.current;
  const issued = deps.session ?? await issueFresh(deps);
  const sess = toPageSession(issued);
  ref.current = sess;
  useBlockStore.getState().setStates(extractBlocks(issued));
  // G-8: tool_specs feed the throbber-label registry, components read
  // progress_label
  useToolSpecsStore.getState().setSpecs(issued.tool_specs ?? []);
  // H.13.d: code-mode gets ghosts as the initial ghost queue; non-code
  // mode backends send [], and seeding an empty array is a reset, so no
  // ghost renders.
  useGhostsStore.getState().seed(issued.ghosts ?? []);
  // #109/#110: dock buttons the owner configured on the role (≤2, already
  // filtered for code-deny) → rendered by ChatRoom.
  useDockButtonsStore.getState().setButtons(issued.dock_buttons ?? []);
  return sess;
}

// IssuedSessionWithExtras —— sdk-core's PublicSessionResponse already
// includes blocks? / tool_specs? / system_prompt_part_ids?; aliased
// here so this file needs fewer imports.
type IssuedSessionWithExtras = PublicSessionResponse;

function toPageSession(issued: IssuedSessionWithExtras): PageSession {
  return {
    sessionToken: issued.session_token,
    conversationID: issued.conversation_id,
    systemPromptPartIDs: issued.system_prompt_part_ids ?? ['visitor-header'],
    persona: issued.system_prompt_persona ?? '',
  };
}

function extractBlocks(issued: IssuedSessionWithExtras): readonly {
  id: string; enabled: boolean; quota_remaining?: number; policy_summary?: string;
}[] {
  return issued.blocks ?? [];
}

async function issueFresh(deps: SessionDeps): Promise<PublicSessionResponse> {
  const stored = loadStoredSession();
  return stored !== null
    ? reuseStored(stored)
    : await issueByMode(deps);
}

// reuseStored —— rebuild PublicSessionResponse from the persisted blob.
// G-1 fix: persist + restore blocks + tool_specs (D-5 lost them).
type StoredFull = Pick<PublicSessionResponse,
  'session_token' | 'conversation_id' | 'blocks' | 'tool_specs' |
  'system_prompt_part_ids' | 'system_prompt_persona' | 'ghosts' | 'dock_buttons'>;

function reuseStored(stored: StoredFull): PublicSessionResponse {
  return {
    session_token: stored.session_token,
    conversation_id: stored.conversation_id,
    blocks: stored.blocks,
    tool_specs: stored.tool_specs,
    system_prompt_part_ids: stored.system_prompt_part_ids,
    system_prompt_persona: stored.system_prompt_persona,
    ghosts: stored.ghosts,
    dock_buttons: stored.dock_buttons,
    // The persisted auth-blob carries no quota/members (that's
    // SessionStrip's display source, kept in a different store); this
    // reuse path only feeds the agent turn and doesn't need it, so a
    // placeholder empty value goes here.
    quota: { max_turns: 0, used_turns: 0, max_members: 0 },
    members: [],
  };
}

// issueByMode —— a fresh session when none is stored. A code visitor's session is only ever opened
// at entry, with the code (gate / ?code=); reaching here in code mode means that session is gone
// (the code was revoked or expired, and its sessions were purged). Such a visitor no longer holds
// a code, so they ask as a public visitor. This used to send `{mode:'code', code:''}`: the backend
// answered 400 and the home page printed "error: issue session: 400" (sijie.xyz, 2026-10-04).
async function issueByMode(deps: SessionDeps): Promise<PublicSessionResponse> {
  if (deps.mode === 'public' || deps.mode === 'code') return issuePublicSession();
  const meta = readBYOAIVaultMeta();
  return issueBYOAISession({ byoai_provider: meta?.provider ?? 'anthropic' });
}
