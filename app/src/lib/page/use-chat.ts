// use-chat —— visitor chat 的 UI 状态机：UI 吃 Dialog[] state，内部走
// VisitorTurnAgent + 真 prod adapters (H.10: agent loop 在 backend eino，
// 浏览器一次 POST /agent/turn，SSE 事件聚合成 Dialog)。
//
// ChatState 接口：caller (PageShell / FloatingChatDock / ChatRoom) 不变
// 拿 dialogs / pending / error + ask / reset。
//
// 命名 (G-1.5)：
//   - Turn → Dialog (一轮 visitor 问 + AI 答 + cited，跟 backend domain.Dialog 对齐)
//   - useConversation → useChat (Chat 是聚合根，dialog 是子 entity)
//   - Citation.kind → genre, Citation.id → path (后端复用 DocumentGenre，前端字段名说实话)
//
// 事件聚合:
//   - tool_completed corpus_read 事件 → cited 列表
//   - Dialog.answer.paras 仍由 body 拆段；body 从 llm_chunk text deltas 累积

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VisitorTurnAgent, type DocContext } from '@standmeet/agent-core';
import type { EventObserver, Message } from '@standmeet/agent-core';
import {
  httpPromptSource, httpAgentTurnStreamer,
  type HttpBYOAIHeaders,
} from '@standmeet/sdk';

import { wrapBYOAIKey } from '@/lib/gate/byoai-envelope';
import { readBYOAICredFull } from '@/lib/gate/byoai-vault';
import {
  restoreSession, revalidateSession, revalidateStored, seedEphemeralStores,
} from '@/lib/page/use-chat-restore';
import {
  handleAgentEvent, makeAccumulator, markFailed, newPendingDialog, turnSucceeded, updateDialog,
  type Dialog, type DialogAccumulator,
} from '@/lib/page/dialog-stream';
import {
  ensureEffectiveSession,
  type PageSession,
  type SessionMode as SessionModeT,
} from '@/lib/page/use-chat-session';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useGhostsStore } from '@/lib/visitor/ghosts-store';

// Domain shapes live in dialog-stream (SRP split); components keep this import path.
export type {
  Answer, Citation, Dialog, ToolCallView, ToolThrobberView,
} from '@/lib/page/dialog-stream';

export type SessionMode = SessionModeT;

export type ChatState = {
  dialogs: Dialog[];
  pending: boolean;
  error: string | null;
  ask: (q: string) => Promise<void>;
  reset: () => void;
  // conversationID —— 这段 chat 落地的 conversation id(主 chat = session 自带;
  // 浮窗 = lazy 解析的 doc 对话)。#122 约成卡发确认信要带它(后端按它定位最近一笔
  // 预约)。开局可能空(浮窗首问前未解析),BookCard 出现时必非空。
  conversationID: string;
};

type Deps = {
  mode: SessionMode;
  // docContext —— 访客当前所在 doc(doc 页/浮窗 chat);主 chat 全屏 = undefined。
  // 透到 /agent/turn 让 AI 解析「this/这篇」指代(#36)。
  docContext?: DocContext;
};

export function useChat(deps: Deps): ChatState {
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // conversationID —— 暴露给 BookCard(#122 发确认信带它)。主 chat mount 时从 stored
  // 灌;每次 ask 解析出 effective conversation(浮窗 doc 对话)后同步。
  const [conversationID, setConversationID] = useState<string>('');
  const sessionRef = useRef<PageSession | null>(null);
  const messageHistRef = useRef<Message[]>([]);
  const counter = useRef(0);
  // 多对话模型:浮窗(有 docContext)用自己那段对话,不蹭主对话。docConvRef 缓存
  // 解析出的 doc conversation_id(首次发问时 lazy POST /conversations);docCtxRef
  // 让 mount effect 不把它进依赖数组(浮窗那段不在 mount 恢复,首次发问才建,开局空)。
  const docConvRef = useRef<string | null>(null);
  const docCtxRef = useRef(deps.docContext);
  docCtxRef.current = deps.docContext;

  // H.13.d: mount 时若 localStorage 已有 stored session，把临时投影(ghosts/specs/dock/caps)
  // 补回各 store —— ensureSession 是 lazy(只发问时跑)，不补这一勺初始 chat 屏就空。
  useEffect(() => {
    const stored = seedEphemeralStores();
    // 浮窗(有 docContext)不恢复主对话 —— 那是别段,会串。它自己那段开局空,首次
    // 发问才 lazy 建/续(ensureEffectiveSession)。主 chat 才走 restoreSession。
    if (docCtxRef.current !== undefined) return;
    // 刷新恢复:有 stored session 就按 token 拉回主对话的 Q&A 重建 transcript
    // (纯内存 dialogs 刷新会空,这里补回来)。失败 → 空,跟现在一样不崩。
    const token = stored?.session_token ?? '';
    const conv = stored?.conversation_id ?? '';
    if (conv !== '') setConversationID(conv);
    if (token !== '' && conv !== '') void restoreSession(conv, token, setDialogs);
  }, []);

  // strip 的 used 是 **member 级**(后端跨该人全部对话合计),不再从本地 dialogs
  // 数 —— 多对话下单 surface 的本地轮数会少算。seed 走 session issue 的
  // quota.used_turns(已 member 级),每答成一轮乐观 +1(runAsk),load/reconcile
  // 由后端权威值纠正。

  // 换人:SessionStrip 点名字重开 picker → 发新名字 issue 出新 session(新
  // member / 新对话),session store 的 startedAt 随之变。chat 据此丢掉旧
  // transcript + 缓存的 session,下一问从新 stored session 起。新 session 的
  // ghosts 已由 issue 重新 seed,这里不碰 ghosts。
  const startedAt = useVisitorSessionStore((s) => s.session?.startedAt ?? 0);
  const lastStartedAt = useRef(startedAt);
  useEffect(() => {
    if (lastStartedAt.current !== 0 && startedAt !== lastStartedAt.current) {
      sessionRef.current = null;
      setDialogs([]);
      setError(null);
      messageHistRef.current = [];
    }
    lastStartedAt.current = startedAt;
  }, [startedAt]);

  const nextID = useCallback((): string => {
    counter.current += 1;
    return `d${counter.current}`;
  }, []);

  const ask = useCallback(async (text: string): Promise<void> => {
    const q = text.trim();
    if (q === '' || pending) return;
    await runAsk(q, deps, { sessionRef, docConvRef, histRef: messageHistRef },
      { setDialogs, setPending, setError, setConvID: setConversationID }, nextID);
  }, [deps, pending, nextID]);

  const reset = useCallback((): void => {
    setDialogs([]);
    setError(null);
    messageHistRef.current = [];
    // H.13.d: 新 chat session 重新接 ghost；不 clear 会把上一段 follow-up
    // 队列带过来。
    useGhostsStore.getState().clear();
  }, []);

  return { dialogs, pending, error, ask, reset, conversationID };
}

// AskRefs / AskSetters —— runAsk 的 ref / setter 打包,避开多参数(eslint
// max-params)。docConvRef 是多对话模型新增:浮窗那段对话的 id 缓存。
interface AskRefs {
  sessionRef: React.MutableRefObject<PageSession | null>;
  docConvRef: React.MutableRefObject<string | null>;
  histRef: React.MutableRefObject<Message[]>;
}

interface AskSetters {
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>;
  setPending: (b: boolean) => void;
  setError: (e: string | null) => void;
  // setConvID —— effective conversation 解析后回灌(#122 BookCard 要这段对话 id)。
  setConvID: (id: string) => void;
}

async function runAsk(
  q: string,
  deps: Deps,
  refs: AskRefs,
  setters: AskSetters,
  nextID: () => string,
): Promise<void> {
  const { setDialogs, setPending, setError, setConvID } = setters;
  const id = nextID();
  setError(null);
  setPending(true);
  setDialogs((prev) => [...prev, newPendingDialog(id, q)]);
  try {
    const sess = await ensureEffectiveSession(
      refs.sessionRef, refs.docConvRef, deps, deps.docContext);
    setConvID(sess.conversationID);
    const byoai = await wrapBYOAIFor(deps, sess);
    const accum = makeAccumulator();
    await runAgentForDialog(sess, byoai, refs.histRef, q,
      makeObserver(id, accum, setDialogs), deps.docContext);
    finalizeDialog(id, accum, setDialogs);
    // F-A-9: policy 沉默(这轮没出 ghost 帧)→ 清掉上一条 steering ghost,别让已访问 waypoint 的
    // 陈旧 ghost 挂在输入框上。出了新帧(ghostReceived)则 setPolicy 已替换,不清。非 code visitor
    // ghost 恒 null,这里是无副作用的 no-op。
    if (!accum.ghostReceived) {
      useGhostsStore.getState().clearGhost();
    }
    // backend 拥有这一轮:/agent/turn 流末端已把它 sink 进 conversation 表(#28),
    // 前端不再自落库。答完那条留在本地 transcript 显示,used 由 dialogs 派生(下面
    // mirror effect)自然 +1;真相在后端,刷新走 restoreSession 从 conversation 重建。
    // 失败/掐断(含 401)→ revalidate 收口:会话若死了清身份回入口。
    // 答成 → member 级 used 乐观 +1(任意 surface 都烧同一个共享预算);失败/掐断
    // → 不计数,回头确认会话是否还活着。
    if (turnSucceeded(accum)) {
      useVisitorSessionStore.getState().incUsed();
    } else {
      void revalidateSession(sess.conversationID, sess.sessionToken);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chat failed';
    setError(msg);
    setDialogs((prev) => markFailed(prev, id, msg));
    void revalidateStored();
  } finally {
    setPending(false);
  }
}

// wrapBYOAIFor —— byoai mode 时从 vault 拿 plaintext key 用 HKDF(session_token)
// 派 AES key 信封过；其他 mode 返 undefined。
async function wrapBYOAIFor(
  deps: Deps, sess: PageSession,
): Promise<HttpBYOAIHeaders | undefined> {
  if (deps.mode !== 'byoai') return undefined;
  const cred = await readBYOAICredFull();
  if (!cred) return undefined;
  const wrappedKey = await wrapBYOAIKey(cred.key, sess.sessionToken);
  return {
    provider: cred.provider, endpoint: cred.endpoint,
    model: cred.model, wrappedKey,
  };
}

function makeObserver(
  dialogID: string,
  accum: DialogAccumulator,
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>,
): EventObserver {
  return {
    onEvent(ev): void {
      handleAgentEvent(ev, accum);
      setDialogs((prev) => updateDialog(prev, dialogID, accum, true));
    },
  };
}

function finalizeDialog(
  id: string, accum: DialogAccumulator,
  setDialogs: React.Dispatch<React.SetStateAction<Dialog[]>>,
): void {
  setDialogs((prev) => updateDialog(prev, id, accum, false));
}

async function runAgentForDialog(
  sess: PageSession,
  byoai: HttpBYOAIHeaders | undefined,
  histRef: React.MutableRefObject<Message[]>,
  userMessage: string,
  observer: EventObserver,
  docContext?: DocContext,
): Promise<void> {
  const agent = buildPageAgent(sess, byoai, observer, docContext);
  const next = await agent.send({
    userMessage, history: histRef.current,
  });
  histRef.current = [...next];
}

function buildPageAgent(
  sess: PageSession,
  byoai: HttpBYOAIHeaders | undefined,
  observer: EventObserver,
  docContext?: DocContext,
): VisitorTurnAgent {
  // H.10: backend (eino ADK) 接管 agent loop；浏览器只调一次 /agent/turn
  // 收 SSE 事件。不再需要 capabilities / llm / tools 三个 port，整套
  // loop / dispatch 全在 backend。
  return new VisitorTurnAgent(
    {
      prompts: httpPromptSource({ baseURL: '' }),
      turn: httpAgentTurnStreamer({
        baseURL: '', sessionToken: sess.sessionToken, byoai,
      }),
      observer,
    },
    {
      systemPromptPartIDs: assembledPartIDs(sess),
      conversationID: sess.conversationID,
      docContext,
    },
  );
}

function assembledPartIDs(sess: PageSession): readonly string[] {
  return sess.systemPromptPartIDs;
}

