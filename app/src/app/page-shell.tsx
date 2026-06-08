// page-shell —— / 根公开页的 client 容器（v1 单 owner instance）。把 SSR fetch
// 好的 owner + content 接给设计稿那套：TopBar / Banners / Hero / Conversation /
// Insights / Projects / Where / Contact / Footer，dark 切换 + chat 状态在这一层管。
//
// mode 来自 localStorage（use-gate.persistSession 写的 visitor-session），
// 不再读 URL `?byoai=1` —— flag-on-URL 是坏设计（URL 上落历史 / 截图 / 分享时
// 泄漏 + 状态边界混乱）。BYOAI 流程：visitor 在 /gate 提交 → use-gate 写
// localStorage → router.push('/') → 这里读 store → 渲染 byoai banner。

'use client';

import { useState } from 'react';
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
  const mode = useSessionMode();
  const isChatMode = useChatModeDetect();
  return isChatMode
    ? <ChatRoom owner={owner} mode={mode} />
    : <LongScrollBody owner={owner} content={content} mode={mode} />;
}

function useChatModeDetect(): boolean {
  const session = useVisitorSessionStore((s) => s.session);
  return session !== null && (session.code !== null || session.byoai);
}

// useSessionMode —— mode 直接从 session store 派生(reactive):名字选择器
// issue session(setSession)后无需额外 sync,mode 自动从 public 切到 code。
// store 由 SessionStrip 的 bindVisitorSessionSync 在 mount 时从 localStorage
// hydrate(返客)。顺手挂 useAbsorbCodeFromURL 吸 ?code=(只存 pending,不 issue)。
function useSessionMode(): SessionMode {
  useAbsorbCodeFromURL();
  const session = useVisitorSessionStore((s) => s.session);
  return session === null ? 'public' : session.byoai ? 'byoai' : 'code';
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
            <ConversationDeck
              ownerHandle={owner.handle} dialogs={chat.dialogs}
              onReset={chat.reset} onAsk={onAsk}
            />
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

