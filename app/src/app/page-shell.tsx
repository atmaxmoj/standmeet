// page-shell — the client container for the / root public page (v1 single-owner instance).
// Wires the SSR-fetched owner + content into the design's layout: TopBar / Banners / Hero /
// Conversation / Insights / Projects / Where / Contact / Footer. Dark-mode toggle + chat
// state are managed at this layer.
//
// mode comes from localStorage (the visitor-session written by use-gate.persistSession),
// not from the URL `?byoai=1` anymore — flag-on-URL is bad design (it leaks into browser
// history / screenshots / shares, and blurs the state boundary). BYOAI flow: the visitor
// submits on /gate → use-gate writes localStorage → router.push('/') → this reads the store
// → renders the byoai banner.

'use client';

import { useRouter } from 'next/navigation';
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
import { useGhostLogger } from '@/lib/page/use-ghost-logger';
import { useIsQuotaExhausted, useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useCurrentGhost } from '@/lib/visitor/ghosts-store';

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

// useSessionMode — mode derives directly from the session store (reactive): once the name
// picker issues a session (setSession), no extra sync is needed — mode auto-switches from
// public to code. The store is hydrated from localStorage on mount by SessionStrip's
// bindVisitorSessionSync (for returning visitors). Also mounts useAbsorbCodeFromURL to
// absorb ?code= (only stores it as pending, doesn't issue).
function useSessionMode(): SessionMode {
  useAbsorbCodeFromURL();
  const session = useVisitorSessionStore((s) => s.session);
  return session === null ? 'public' : session.byoai ? 'byoai' : 'code';
}

function LongScrollBody({ owner, content, mode }: Props & { mode: SessionMode }) {
  const { dark, toggle } = useTheme();
  const chat = useChat({ mode });
  const exhausted = useIsQuotaExhausted();
  const router = useRouter();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ghost = useCurrentGhost();
  const ghostLogger = useGhostLogger();

  // The long-scroll body only renders for visitors with **no chat session** (public) — asking
  // a question here never answers inline; it always hands off to /gate (fill in code/BYOAI),
  // carrying the question via ?q=, then continues answering in ChatRoom past the gate. A
  // codeless visitor must not chat directly with the owner's key.
  const onAsk = useCallback((q: string) => {
    setInput('');
    router.push(gateHref(q));
  }, [router]);

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
          />
          {chat.dialogs.length > 0 && (
            <ConversationDeck
              ownerHandle={owner.handle} dialogs={chat.dialogs}
              onAsk={onAsk} conversationID={chat.conversationID}
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

// gateHref — carries a homepage question to /gate (plain /gate if the question is empty).
// After the gate, gate redirects to /?q= to continue answering.
function gateHref(q: string): string {
  const trimmed = q.trim();
  return trimmed === '' ? '/gate' : `/gate?q=${encodeURIComponent(trimmed)}`;
}

function buildAskedSet(dialogs: ReturnType<typeof useChat>['dialogs']): ReadonlySet<string> {
  const questions: string[] = [];
  for (const d of dialogs) questions.push(d.q);
  return new Set(questions);
}

