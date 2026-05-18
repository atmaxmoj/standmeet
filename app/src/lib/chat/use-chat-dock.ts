// use-chat-dock —— ChatDock 的 state machine + 控制流。
//
// 摆在 lib/ 下不在 components/ 下因为 eslint 把 src/components/**/*.tsx 标为
// presentation 禁 `if` —— 真业务逻辑（session lazy 创建、stream 累加、错误
// 兜底）按规约都必须下沉。组件只读 hook 返回值，不算逻辑。
//
// 设计：
//   - sessionRef lazy 持有（用户第一次问才发 POST /sessions）
//   - streamingTextRef 累加 token，setMessages 用 ref 当前值写最后一条
//     （参考 [[legacy-gems]] A1 ref-batched 模式，避开 React closure stale）
//   - send 单飞行：sending=true 时再次调用立即 return
//   - 错误时把占位 assistant msg 撤掉 + setError

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  issuePublicSession,
  streamChatMessage,
  type PublicSessionResponse,
  type SSEEvent,
} from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';

export type ChatMsg =
  | { role: 'visitor'; content: string }
  | { role: 'assistant'; content: string; cited: readonly string[]; streaming: boolean };

export type ChatDockState = {
  messages: ChatMsg[];
  input: string;
  sending: boolean;
  error: string | null;
  setInput: (v: string) => void;
  send: (text: string) => Promise<void>;
  handleSend: () => void;
};

type Setter = React.Dispatch<React.SetStateAction<ChatMsg[]>>;

export function useChatDock(handle: string): ChatDockState {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<PublicSessionResponse | null>(null);
  const streamRef = useRef('');

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    const blocked = trimmed === '' || sending;
    blocked || (await runSend(trimmed, handle, sessionRef, streamRef, setMessages, setSending, setError));
  }, [handle, sending]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    setInput('');
    void send(text);
  }, [input, send]);

  return { messages, input, setInput, sending, error, send, handleSend };
}

// useExternalQuestion —— Hero 的 askable 按钮点了之后通过 pending 推一个
// 问题进 ChatDock；这个 hook 监听变更，自动 send + consume。
export function useExternalQuestion(
  pending: string | null,
  onConsume: () => void,
  send: (q: string) => Promise<void>,
) {
  useEffect(() => {
    const has = pending !== null && pending !== '';
    has && dispatchExternal(pending, send, onConsume);
  }, [pending, onConsume, send]);
}

function dispatchExternal(
  pending: string,
  send: (q: string) => Promise<void>,
  onConsume: () => void,
) {
  void send(pending);
  onConsume();
}

async function runSend(
  text: string,
  handle: string,
  sessionRef: React.MutableRefObject<PublicSessionResponse | null>,
  streamRef: React.MutableRefObject<string>,
  setMessages: Setter,
  setSending: (v: boolean) => void,
  setError: (e: string | null) => void,
) {
  setSending(true);
  setError(null);
  setMessages((prev) => [
    ...prev,
    { role: 'visitor', content: text },
    { role: 'assistant', content: '', cited: [], streaming: true },
  ]);
  streamRef.current = '';
  try {
    const sess = await ensureSession(sessionRef, handle);
    await drainStream(sess, text, setMessages, streamRef);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'chat failed';
    setError(msg);
    setMessages((prev) => prev.slice(0, -1));
  } finally {
    setSending(false);
  }
}

async function ensureSession(
  ref: React.MutableRefObject<PublicSessionResponse | null>,
  handle: string,
): Promise<PublicSessionResponse> {
  return ref.current ?? (ref.current = await loadOrIssueSession(handle));
}

// loadOrIssueSession —— gate page 可能已经写过 session 进 localStorage（M9
// BYOAI / code-tier 流程）。如果有就直接用，不再 POST 新 session；否则
// 默认 public-tier 颁发（M7 visitor 路径）。
async function loadOrIssueSession(handle: string): Promise<PublicSessionResponse> {
  const stored = loadStoredSession();
  if (stored && stored.owner_handle === handle) {
    return {
      session_token: stored.session_token,
      conversation_id: stored.conversation_id,
      owner_handle: stored.owner_handle,
      included_tags: [],
      excluded_tags: [],
    };
  }
  return await issuePublicSession(handle);
}

async function drainStream(
  sess: PublicSessionResponse,
  text: string,
  setMessages: Setter,
  streamRef: React.MutableRefObject<string>,
) {
  for await (const ev of streamChatMessage(sess.conversation_id, sess.session_token, text)) {
    applyStreamEvent(ev, setMessages, streamRef);
  }
}

function applyStreamEvent(
  ev: SSEEvent,
  setMessages: Setter,
  streamRef: React.MutableRefObject<string>,
) {
  switch (ev.kind) {
    case 'token':
      streamRef.current += ev.text;
      setMessages((prev) => replaceLastAssistant(prev, streamRef.current, [], true));
      break;
    case 'done':
      setMessages((prev) => replaceLastAssistant(prev, streamRef.current, ev.cited_wiki_ids, false));
      break;
    case 'error':
      setMessages((prev) => replaceLastAssistant(prev, `_error_: ${ev.message}`, [], false));
      break;
  }
}

function replaceLastAssistant(
  prev: ChatMsg[], content: string, cited: readonly string[], streaming: boolean,
): ChatMsg[] {
  const last = prev[prev.length - 1];
  const head = prev.slice(0, -1);
  return last !== undefined && last.role === 'assistant'
    ? [...head, { role: 'assistant', content, cited, streaming }]
    : [...prev, { role: 'assistant', content, cited, streaming }];
}
