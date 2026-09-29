// chat-controller —— one conversation's state for a chat surface: the engine (useChat), the input,
// the ghost and the quota lock. Every layout (the app room, the dock, a microsite rail, the embed)
// takes its state from here, so none of them wires the pieces differently. The presentation layer
// isn't allowed to run if / complex logic, so it lives here.

import { useCallback, useState } from 'react';
import type { DocContext } from '@standmeet/agent-core';

import { useChat, type SessionMode } from './use-chat.js';
import { useGhostLogger } from './use-ghost-logger.js';
import { useIsQuotaExhausted, useVisitorSessionStore } from './session-store.js';
import { useCurrentGhost } from './ghosts-store.js';

export interface ChatRoomDerived {
  mode: 'coded' | 'byoai';
  codeLabel: string;
  visitor: string | null;
  provider: string;
}

export function useChatRoomDerived(): ChatRoomDerived {
  const session = useVisitorSessionStore((s) => s.session);
  return {
    mode: session?.byoai ? 'byoai' : 'coded',
    codeLabel: session?.label ?? 'invited',
    visitor: session?.visitor ?? null,
    provider: session?.byoaiProvider ?? 'claude',
  };
}

// useChatController —— docContext: the document the visitor is reading (a microsite page, a wiki
// note); the conversation about it is its own thread (see use-chat). Absent = the main chat.
// persistKey: keep that thread in this browser (see use-chat).
export function useChatController(mode: SessionMode, docContext?: DocContext, persistKey?: string) {
  const chat = useChat({ mode, docContext, persistKey });
  const exhausted = useIsQuotaExhausted();
  const [input, setInput] = useState('');
  const ghost = useCurrentGhost();
  const ghostLogger = useGhostLogger();

  const onAsk = useCallback((q: string) => {
    setInput('');
    void chat.ask(q);
  }, [chat]);

  // H.13.d: Tab accepts the ghost → fills the input without auto-submitting;
  // the visitor decides whether to send right away or keep editing.
  // H.13.e: also fires accept so the admin backend can log it.
  const onAcceptGhost = useCallback((g: string) => {
    setInput(g);
    ghostLogger.acceptCurrent();
  }, [ghostLogger]);

  return { chat, exhausted, input, setInput, onAsk, ghost, onAcceptGhost };
}
