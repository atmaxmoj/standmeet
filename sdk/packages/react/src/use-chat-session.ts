// use-chat-session.ts —— the chat as plain state, for an author who draws their own chat UI on a
// microsite: `{ messages, streaming, error, send }`. It is a view of the one chat engine
// (chat/use-chat.ts, the same one the app and <Agent> run), not a second engine: the code's
// session, the persona, the quota, the per-page thread and the model's memory across a reload all
// come from there. The visitor's-own-key path lives in <Agent>; here `byok.available` is false.

import { useMemo } from 'react';
import { pageDocContext, type IssueSessionInput } from '@standmeet/sdk-core';

import { useChat } from './chat/use-chat.js';
import type { Dialog } from './chat/dialog-stream.js';

export interface ChatMessage {
  id: string;
  role: 'visitor' | 'assistant';
  text: string;
}

// ChatTool —— the tool the agent is running right now, for a progress throbber. null = plain thinking.
export interface ChatTool {
  name: string;
  label: string;
}

export interface ChatState {
  messages: readonly ChatMessage[];
  streaming: boolean;
  tool: ChatTool | null;
  error: string | null;
  // errorCode —— the machine code of the last turn's error ('rate_limited', …).
  errorCode: string | null;
  byok: { available: false };
  send: (text: string) => Promise<void>;
  // clear —— a new conversation: the transcript, this page's saved copy, the model's history.
  clear: () => void;
}

export function useChatSession(input: Pick<IssueSessionInput, 'mode'>): ChatState {
  // Effects never run on the server, so the client-only key is what every effect sees.
  const onClient = typeof window !== 'undefined';
  const persistKey = onClient ? `session:${window.location.pathname}` : undefined;
  const docContext = useMemo(() => {
    const dc = onClient ? pageDocContext() : null;
    return dc?.path !== undefined && dc.genre !== undefined
      ? { title: dc.title, path: dc.path, genre: dc.genre }
      : undefined;
  }, [onClient]);
  const chat = useChat({ mode: input.mode, docContext, persistKey });
  const last = chat.dialogs.at(-1);
  return {
    messages: chat.dialogs.flatMap(toMessages),
    streaming: chat.pending,
    tool: last?.pending === true && last.currentTool !== null ? last.currentTool : null,
    error: chat.error,
    errorCode: last?.answer.errorCode ?? null,
    byok: { available: false },
    send: chat.ask,
    clear: chat.reset,
  };
}

function toMessages(d: Dialog): ChatMessage[] {
  const answer = d.answer.paras.join('\n\n');
  return [
    { id: `${d.id}-q`, role: 'visitor', text: d.q },
    { id: `${d.id}-a`, role: 'assistant', text: d.pending ? '' : answer },
  ];
}
