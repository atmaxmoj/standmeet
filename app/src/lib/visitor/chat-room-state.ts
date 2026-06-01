// chat-room-state —— ChatRoom 的 derived state。presentation 层不准跑
// if / 复杂逻辑，所以抽到 lib/。

import { useCallback, useState } from 'react';

import { useChat, type SessionMode } from '@/lib/page/use-chat';
import { useIsQuotaExhausted, useVisitorSessionStore } from '@/lib/visitor/session-store';

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

  const onAsk = useCallback((q: string) => {
    setInput('');
    void chat.ask(q);
  }, [chat]);

  return { chat, exhausted, input, setInput, onAsk };
}
