// use-chat-session.ts —— chat 状态机 hook。封装：
//   1) issueSession（首次提问时按 mode 申请 visitor session）
//   2) streamMessage（每条消息走 SSE 收 token）
//   3) message 数组累加；streaming flag；error 暴露
//
// 设计选择：sessionToken 存 hook 内部 state，不暴露给 caller，让 UI 不
// 关心 session 生命周期。caller 只做 send(text)、看 messages / streaming。

import { useCallback, useRef, useState } from 'react';
import type {
  IssueSessionInput,
  SSEEvent,
} from '@standmeet/sdk-core';
import { useStandMeet } from './provider.js';

export interface ChatMessage {
  id: string;
  role: 'visitor' | 'assistant';
  text: string;
  citedWikiIDs?: readonly string[];
}

export interface ChatState {
  messages: readonly ChatMessage[];
  streaming: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
}

export function useChatSession(input: IssueSessionInput): ChatState {
  const client = useStandMeet();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<{ id: string; token: string } | null>(null);
  const counter = useRef(0);
  const nextID = useCallback((): string => {
    counter.current += 1;
    return `m${counter.current}`;
  }, []);

  const send = useCallback(async (text: string): Promise<void> => {
    setError(null);
    setStreaming(true);
    appendVisitor(setMessages, text, nextID());
    const assistantID = nextID();
    appendAssistant(setMessages, assistantID);
    try {
      if (!sessionRef.current) {
        const s = await client.issueSession(input);
        sessionRef.current = { id: s.conversation_id, token: s.session_token };
      }
      const sess = sessionRef.current;
      for await (const ev of client.streamMessage(sess.id, sess.token, text)) {
        applyEvent(setMessages, assistantID, ev);
        if (ev.kind === 'error') setError(ev.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }, [client, input, nextID]);

  return { messages, streaming, error, send };
}

function appendVisitor(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  text: string, id: string,
): void {
  setMessages((prev) => [...prev, { id, role: 'visitor', text }]);
}

function appendAssistant(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>, id: string,
): void {
  setMessages((prev) => [...prev, { id, role: 'assistant', text: '' }]);
}

function applyEvent(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  id: string, ev: SSEEvent,
): void {
  setMessages((prev) => prev.map((m) => {
    if (m.id !== id) return m;
    if (ev.kind === 'token') return { ...m, text: m.text + ev.text };
    if (ev.kind === 'done') return { ...m, citedWikiIDs: ev.cited_wiki_ids };
    return m;
  }));
}
