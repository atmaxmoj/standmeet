// chat-room-state —— ChatRoom 的 derived state。presentation 层不准跑
// if / 复杂逻辑，所以抽到 lib/。

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

  // H.13.d: Tab 接受 ghost → 填进 input 不自动 submit；visitor 自己决定
  // 直接 send 还是继续编辑。H.13.e: 同时 fire accept 让 admin 后台日志。
  const onAcceptGhost = useCallback((g: string) => {
    setInput(g);
    ghostLogger.acceptCurrent();
  }, [ghostLogger]);

  return { chat, exhausted, input, setInput, onAsk, ghost, onAcceptGhost };
}
