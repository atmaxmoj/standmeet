// page-shell —— / 根公开页的 client 容器（v1 单 owner instance）。把 SSR fetch
// 好的 owner + content 接给设计稿那套：TopBar / Banners / Hero / Conversation /
// Insights / Projects / Where / Contact / Footer，dark 切换 + chat 状态在这一层管。
//
// mode 来自 localStorage（use-gate.persistSession 写的 visitor-session），
// 不再读 URL `?byoai=1` —— flag-on-URL 是坏设计（URL 上落历史 / 截图 / 分享时
// 泄漏 + 状态边界混乱）。BYOAI 流程：visitor 在 /gate 提交 → use-gate 写
// localStorage → router.push('/') → 这里读 store → 渲染 byoai banner。

'use client';

import { useEffect, useState } from 'react';
import { useCallback, useRef } from 'react';

import type { PageContent, PublicOwnerView } from '@/lib/api/public';

import { Contact } from '@/components/Contact';
import { QuickAskDeck } from '@/components/QuickAskDeck';
import { Hero } from '@/components/Hero';
import { Insights } from '@/components/Insights';
import { Projects } from '@/components/Projects';
import { Where } from '@/components/Where';
import { ConversationDeck } from '@/components/page/ConversationDeck';
import { Footer } from '@/components/page/Footer';
import { TopBar } from '@/components/page/TopBar';
import { ChatRoom } from '@/components/visitor/ChatRoom';
import { SessionStrip } from '@/components/visitor/SessionStrip';
import { VisitorNamePicker } from '@/components/visitor/VisitorNamePicker';
import { loadStoredSession } from '@/lib/gate/use-gate';
import { useAbsorbCodeFromURL } from '@/lib/gate/use-absorb-code';
import { useConsumeQuestionFromURL } from '@/lib/page/consume-question-url';
import { useTheme } from '@/lib/page/use-theme';
import { useChat } from '@/lib/page/use-chat';
import type { SessionMode } from '@/lib/page/use-chat';
import { useSuggestionLogger } from '@/lib/page/use-suggestion-logger';
import { useIsQuotaExhausted, useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useCurrentGhost, useSuggestionsStore } from '@/lib/visitor/suggestions-store';

type Props = {
  owner: PublicOwnerView;
  content: PageContent;
};

export function PageShell({ owner, content }: Props) {
  const mode = useModeFromStorage();
  const isChatMode = useChatModeDetect();
  return isChatMode
    ? <ChatRoom owner={owner} mode={mode} />
    : <LongScrollBody owner={owner} content={content} mode={mode} />;
}

function useChatModeDetect(): boolean {
  const session = useVisitorSessionStore((s) => s.session);
  return session !== null && (session.code !== null || session.byoai);
}

function LongScrollBody({ owner, content, mode }: Props & { mode: SessionMode }) {
  const { dark, toggle } = useTheme();
  const chat = useChat({ mode });
  const exhausted = useIsQuotaExhausted();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ghost = useCurrentGhost();
  const cycleGhost = useSuggestionsStore((s) => s.cycle);
  const ghostLogger = useSuggestionLogger();

  const onAsk = useCallback((q: string) => {
    setInput('');
    void chat.ask(q);
  }, [chat]);

  useConsumeQuestionFromURL(onAsk);

  const focusChat = useCallback(() => {
    inputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const onAcceptGhost = useCallback((g: string) => {
    setInput(g);
    inputRef.current?.focus();
    ghostLogger.acceptCurrent();
  }, [ghostLogger]);

  return (
    <div className="min-h-screen flex flex-col">
      <SessionStrip />
      <VisitorNamePicker />
      <TopBar handle={owner.handle} dark={dark} onToggleDark={toggle} />
      <main className="flex-1">
        <div className="max-w-[760px] mx-auto px-6 lg:px-0">
          <Hero
            owner={owner}
            content={content}
            input={input}
            setInput={setInput}
            onAsk={onAsk}
            pending={chat.pending}
            lockedReason={exhausted ? 'session full · request more ↗' : null}
            inputRef={inputRef}
            ghost={ghost}
            onAcceptGhost={onAcceptGhost}
            onCycleGhost={cycleGhost}
          />
          {chat.dialogs.length > 0 && (
            <ConversationDeck ownerHandle={owner.handle} dialogs={chat.dialogs} onReset={chat.reset} />
          )}
          <QuickAskDeck
            examples={content.hero_examples}
            askedSet={buildAskedSet(chat.dialogs)}
            onAsk={onAsk}
          />
          <Insights insights={content.insights} />
          <Projects projects={content.projects} />
          <Where where={content.where} />
          <Contact contact={content.contact} onFocusChat={focusChat} />
        </div>
      </main>
      <Footer />
    </div>
  );
}

function buildAskedSet(dialogs: ReturnType<typeof useChat>['dialogs']): ReadonlySet<string> {
  const questions: string[] = [];
  for (const d of dialogs) questions.push(d.q);
  return new Set(questions);
}

// useModeFromStorage —— mount 后读 localStorage 拿 stored visitor-session。
// SSR 初始值是 'public'（hydration mismatch 不可见，banner 走 client only）；
// useEffect 里 syn-read 一次，有 byoai flag → 切 'byoai'，有 session 不带
// byoai → 'code'（gate 提交 access code 后存的），否则 'public'。
// 还顺手挂 useAbsorbCodeFromURL：visitor 带 `?code=ABC` 来时把 code 吸进
// store、清掉 URL、issue session 后回调一次 syncFromStorage。
function useModeFromStorage(): SessionMode {
  const [mode, setMode] = useState<SessionMode>('public');
  const syncFromStorage = useCallback(() => {
    const stored = loadStoredSession();
    setMode(stored ? (stored.byoai ? 'byoai' : 'code') : 'public');
  }, []);
  useEffect(() => { syncFromStorage(); }, [syncFromStorage]);
  useAbsorbCodeFromURL(syncFromStorage);
  return mode;
}
