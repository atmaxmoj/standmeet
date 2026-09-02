// chat-room-state —— derived state for ChatRoom. The presentation layer isn't
// allowed to run if / complex logic, so it's extracted into lib/.

import { useCallback, useState } from 'react';

import { useChat, type SessionMode } from '@/lib/page/use-chat';
import { useGhostLogger } from '@/lib/page/use-ghost-logger';
import { useIsQuotaExhausted, useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useCurrentGhost } from '@/lib/visitor/ghosts-store';

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

export function useChatRoomInput(mode: SessionMode) {
  const chat = useChat({ mode });
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
