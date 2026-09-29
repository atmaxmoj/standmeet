// use-code-test —— the "try it" button in admin /admin/codes's
// VisitorPreviewModal. Lets the owner personally run a code session without
// opening a private browser window:
//   - opens a session (visitor_name = "(owner test)", so it's told apart at a
//     glance from real visitors in the conversations list by visitor_name)
//   - sends a message through the one chat engine (@standmeet/sdk useChat), so
//     what the owner sees is exactly what a visitor's turn does — the same persona,
//     tools and accounting. The session is handed to the engine rather than stored:
//     the owner's browser may hold a visitor session of its own, which this must not replace.

import { useCallback, useState } from 'react';
import { issueCodeSession, useChat } from '@standmeet/sdk';
import type { PublicSessionResponse } from '@standmeet/sdk-core';

export const OWNER_TEST_VISITOR_NAME = '(owner test)';

export type Phase = 'idle' | 'opening' | 'ready' | 'streaming' | 'done' | 'error';

export interface CodeTestState {
  phase: Phase;
  hasSession: boolean;
  reply: string;
  error: string | null;
}

export interface CodeTestHook {
  state: CodeTestState;
  start: (code: string) => Promise<void>;
  send: (text: string) => Promise<void>;
}

export function useCodeTest(): CodeTestHook {
  const [session, setSession] = useState<PublicSessionResponse | undefined>(undefined);
  const [opening, setOpening] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const chat = useChat({ mode: 'code', session, ephemeral: true });

  const start = useCallback(async (code: string) => {
    setOpening({ busy: true, error: null });
    try {
      setSession(await issueCodeSession({ code, visitor_name: OWNER_TEST_VISITOR_NAME }));
      setOpening({ busy: false, error: null });
    } catch (e) {
      setSession(undefined);
      setOpening({ busy: false, error: e instanceof Error ? e.message : 'open session failed' });
    }
  }, []);

  const send = useCallback(async (text: string) => {
    if (text.trim() !== '') await chat.ask(text);
  }, [chat]);

  return { state: stateOf(session !== undefined, opening, chat), start, send };
}

function stateOf(
  hasSession: boolean,
  opening: { busy: boolean; error: string | null },
  chat: ReturnType<typeof useChat>,
): CodeTestState {
  const last = chat.dialogs.at(-1);
  const reply = last?.answer.paras.join('\n\n') ?? '';
  const error = opening.error ?? chat.error;
  return {
    hasSession,
    reply,
    error,
    phase: phaseOf({ hasSession, opening: opening.busy, error, pending: chat.pending, answered: last !== undefined }),
  };
}

function phaseOf(s: { hasSession: boolean; opening: boolean; error: string | null; pending: boolean; answered: boolean }): Phase {
  if (s.error !== null) return 'error';
  if (s.opening) return 'opening';
  if (!s.hasSession) return 'idle';
  if (s.pending) return 'streaming';
  return s.answered ? 'done' : 'ready';
}
