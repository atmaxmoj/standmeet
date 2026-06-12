// use-chat-session —— PageSession 生命周期：ensureSession 单次拉
// /sessions → 缓存；reuseStored 从 localStorage 复活；issueByMode 按
// public/code/byoai 分。从 use-chat.ts 拆出来守 350-line cap。

'use client';

import type { DocContext } from '@standmeet/agent-core';

import {
  issueBYOAISession, issueCodeSession, issuePublicSession,
  openDocConversation,
  type PublicSessionResponse,
} from '@/lib/api/public';
import { readBYOAIVaultMeta } from '@/lib/gate/byoai-vault';
import { loadStoredSession } from '@/lib/gate/use-gate';
import { useCapabilityStore } from '@/lib/visitor/capability-store';
import { useGhostsStore } from '@/lib/visitor/ghosts-store';
import { useToolSpecsStore } from '@/lib/visitor/tool-specs-store';

export type SessionMode = 'public' | 'code' | 'byoai';

// PageSession —— ensureSession 之后内部记一份；含 pi-pivot 用的 part_ids
// + tool_specs。browser 不再 hit /sessions 多次 (老路径每次 ask 都
// reuseStored + 不读 part_ids)；这里 first-ask 拿一次然后整轮持有。
export interface PageSession {
  sessionToken: string;
  conversationID: string;
  systemPromptPartIDs: readonly string[];
  persona: string;
}

export interface SessionDeps {
  mode: SessionMode;
}

// ensureEffectiveSession —— 主 chat 用 session 自带的主 conversation;浮窗(有
// docContext)首次发问时 lazy 解析自己那段 doc conversation(POST /conversations),
// 之后缓存复用。解析失败回退主对话(不崩,代价是这次没分流)。多对话模型核心。
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
  const issued = await issueFresh(deps);
  const sess = toPageSession(issued);
  ref.current = sess;
  useCapabilityStore.getState().setStates(extractCapabilities(issued));
  // G-8: tool_specs 进 throbber-label registry，components 读 progress_label
  useToolSpecsStore.getState().setSpecs(issued.tool_specs ?? []);
  // H.13.d: code-mode 拿到 ghosts 当初始 ghost 队列；非 code
  // mode backend 给 []，seed 空数组等于 reset，ghost 自然不渲。
  useGhostsStore.getState().seed(issued.ghosts ?? []);
  return sess;
}

// IssuedSessionWithExtras —— sdk-core PublicSessionResponse 已含
// capabilities? / tool_specs? / system_prompt_part_ids?；这里 alias 一下
// 让本文件少 import。
type IssuedSessionWithExtras = PublicSessionResponse;

function toPageSession(issued: IssuedSessionWithExtras): PageSession {
  return {
    sessionToken: issued.session_token,
    conversationID: issued.conversation_id,
    systemPromptPartIDs: issued.system_prompt_part_ids ?? ['visitor-header'],
    persona: issued.system_prompt_persona ?? '',
  };
}

function extractCapabilities(issued: IssuedSessionWithExtras): readonly {
  id: string; enabled: boolean; quota_remaining?: number; policy_summary?: string;
}[] {
  return issued.capabilities ?? [];
}

async function issueFresh(deps: SessionDeps): Promise<PublicSessionResponse> {
  const stored = loadStoredSession();
  return stored !== null
    ? reuseStored(stored)
    : await issueByMode(deps);
}

// reuseStored —— rebuild PublicSessionResponse from the persisted blob.
// G-1 fix: persist + restore capabilities + tool_specs (D-5 lost them).
type StoredFull = Pick<PublicSessionResponse,
  'session_token' | 'conversation_id' | 'capabilities' | 'tool_specs' |
  'system_prompt_part_ids' | 'system_prompt_persona' | 'ghosts'>;

function reuseStored(stored: StoredFull): PublicSessionResponse {
  return {
    session_token: stored.session_token,
    conversation_id: stored.conversation_id,
    capabilities: stored.capabilities,
    tool_specs: stored.tool_specs,
    system_prompt_part_ids: stored.system_prompt_part_ids,
    system_prompt_persona: stored.system_prompt_persona,
    ghosts: stored.ghosts,
    // 持久化的 auth-blob 不带 quota/members(那是 SessionStrip 的展示源,存在
    // 另一个 store);这条 reuse 路径只喂 agent turn,用不到,给空值占位。
    quota: { max_turns: 0, used_turns: 0, max_members: 0 },
    members: [],
  };
}

async function issueByMode(deps: SessionDeps): Promise<PublicSessionResponse> {
  if (deps.mode === 'public') return issuePublicSession();
  if (deps.mode === 'code') return issueCodeSession({ code: '' });
  const meta = readBYOAIVaultMeta();
  return issueBYOAISession({ byoai_provider: meta?.provider ?? 'anthropic' });
}
