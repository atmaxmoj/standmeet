// use-chat-session.ts —— the chat state-machine hook. Wraps:
//   1) issueSession (requests a visitor session per mode, on the first question)
//   2) streamMessage (each message receives tokens over SSE)
//   3) accumulating the message array; a streaming flag; error surfacing
//
// Design choice: sessionToken lives in the hook's internal state and is never
// exposed to the caller, so the UI doesn't need to care about session
// lifecycle. The caller only calls send(text) and watches messages / streaming.

import { useCallback, useRef, useState } from 'react';
import type {
  IssueSessionInput,
  SSEEvent,
} from '@standmeet/sdk-core';
import { adoptStoredSession } from '@standmeet/sdk-core';
import { useStandMeet } from './provider.js';

export interface ChatMessage {
  id: string;
  role: 'visitor' | 'assistant';
  text: string;
  citedWikiIDs?: readonly string[];
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
  send: (text: string) => Promise<void>;
}

export function useChatSession(input: IssueSessionInput): ChatState {
  const client = useStandMeet();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [tool, setTool] = useState<ChatTool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<{ id: string; token: string; system: string } | null>(null);
  const counter = useRef(0);
  const nextID = useCallback((): string => {
    counter.current += 1;
    return `m${counter.current}`;
  }, []);

  const send = useCallback(async (text: string): Promise<void> => {
    setError(null);
    setStreaming(true);
    setTool(null);
    appendVisitor(setMessages, text, nextID());
    const assistantID = nextID();
    appendAssistant(setMessages, assistantID);
    try {
      if (!sessionRef.current) {
        // Adopt any session already issued in this browser first. **The page is
        // a rendering of that code**: the reader arrived carrying the code, so
        // the agent on the page must be that code's agent — the same
        // authorization, the same quota, the same accounting. Opening a fresh
        // anonymous session instead looks identical on screen, but the reader's
        // name, allotment, and turn count all get silently dropped. Only open a
        // fresh session from `input` when there's no issued session to adopt
        // (a passing anonymous reader).
        const s = adoptStoredSession() ?? await client.issueSession(input);
        // The system prompt is assembled once per session (fragment + this
        // session's persona). Skipping assembly means an empty system prompt,
        // and the answers that come out have nothing to do with this owner
        // (F-O-2).
        sessionRef.current = {
          id: s.conversation_id, token: s.session_token,
          system: await client.composeSystem(s),
        };
      }
      const sess = sessionRef.current;
      for await (const ev of client.streamMessage(sess.id, sess.token, text, sess.system)) {
        applyEvent(setMessages, assistantID, ev);
        if (ev.kind === 'tool') setTool(ev.name === null ? null : { name: ev.name, label: ev.label });
        if (ev.kind === 'token') setTool(null); // real text is streaming → drop the throbber
        if (ev.kind === 'error') setError(ev.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
      setTool(null);
    }
  }, [client, input, nextID]);

  return { messages, streaming, tool, error, send };
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
