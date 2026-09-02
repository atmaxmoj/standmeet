// FloatingChatDock —— lets a visitor chat without leaving the page, from
// any surface (blog/wiki/output). collapsed = the pill button in the
// bottom-right corner; expanded = the floating panel (input + transcript).
//
// Multi-conversation model: the dock reuses the useChat hook but passes
// docContext, and useChat uses it to lazily resolve **this member's own**
// conversation on this doc (POST /conversations, independent of the main
// chat) — transcripts don't cross-contaminate. The member (name) and the
// turn quota are shared; "cross-awareness" comes from the backend injecting
// all of that member's conversations into the instruction, so this thread
// can answer using things discussed elsewhere. What the owner sees in
// /admin/conversations is multiple conversation rows under that member's
// name.
//
// Design intent (memory: visitor-chat-everywhere): a code-holding visitor
// who finishes reading an article on blog/wiki/output and wants to
// "keep asking" shouldn't have to jump back to `/`. AskAboutThis's starter
// prompt keeps the `?q=` → `/` path; FloatingChatDock goes inline instead.
//
// SSR-safe: the component is 'use client', and every zustand / fetch /
// WebStorage call runs only after mount. **The pill doesn't render in
// public mode**: nobody is paying for inference (the owner doesn't want to
// foot the bill for a passerby, and a visitor without a key isn't billed
// either). It shows only in byoai / code mode.

'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useChat } from '@/lib/page/use-chat';
import type { SessionMode } from '@/lib/page/use-chat';
import type { DocContext } from '@standmeet/agent-core';
import { ChatTranscript, ChatProgress } from '@/components/visitor/ChatTranscript';
import { useGhostLogger } from '@/lib/page/use-ghost-logger';
import {
  useVisitorSessionStore, useIsQuotaExhausted, useVisitorChatAvailable,
} from '@/lib/visitor/session-store';
import { useCurrentGhost } from '@/lib/visitor/ghosts-store';
import { dispatchGhostKey, pickGhost } from '@/lib/visitor/ghost-text';

// docContext —— the doc the visitor is currently on (passed in by the
// wiki/writing/output page), so the AI can resolve "this/this article/this
// project" when asked in the dock (#36). Not passed on the main full-screen
// chat = undefined.
// Whether the pill renders, and what the about-card in the footer says,
// read the **same** criterion (`useVisitorChatAvailable`). This used to
// check `mode === 'public'` on its own, while the card unconditionally
// said "keep asking below" — an anonymous visitor would read a promise
// that this very page had already falsified (UX-86).
export function FloatingChatDock({ docContext }: { docContext?: DocContext }) {
  const canAsk = useVisitorChatAvailable();
  const mode = useModeFromVisitorStore();
  return canAsk ? <FloatingChatDockInner mode={mode} docContext={docContext} /> : null;
}

function FloatingChatDockInner({ mode, docContext }: { mode: SessionMode; docContext?: DocContext }) {
  const [open, setOpen] = useState(false);
  const chat = useChat({ mode, docContext });
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ghost = useCurrentGhost();
  const ghostLogger = useGhostLogger();

  const onAsk = useCallback((q: string) => {
    setInput('');
    void chat.ask(q);
  }, [chat]);

  const onAcceptGhost = useCallback((g: string) => {
    setInput(g);
    inputRef.current?.focus();
    ghostLogger.acceptCurrent();
  }, [ghostLogger]);

  return (
    <>
      <ChatTrigger
        open={open}
        onToggle={() => setOpen((o) => !o)}
        pending={chat.pending}
      />
      {open && (
        <ChatPanel
          input={input}
          setInput={setInput}
          onAsk={onAsk}
          dialogs={chat.dialogs}
          conversationID={chat.conversationID}
          pending={chat.pending}
          inputRef={inputRef}
          ghost={ghost}
          onAcceptGhost={onAcceptGhost}
        />
      )}
    </>
  );
}

// useModeFromVisitorStore —— derives mode from the visitor-session store.
// A fresh visitor with no session → 'public' (pill doesn't render).
function useModeFromVisitorStore(): SessionMode {
  return deriveModeFromSession(useVisitorSessionStore((s) => s.session));
}

function deriveModeFromSession(
  session: ReturnType<typeof useVisitorSessionStore.getState>['session'],
): SessionMode {
  return !session ? 'public' : session.byoai ? 'byoai' : 'code';
}

function ChatTrigger({
  open, onToggle, pending,
}: { open: boolean; onToggle: () => void; pending: boolean }) {
  return (
    <button
      type="button" onClick={onToggle}
      data-testid="floating-dock-pill"
      aria-label={open ? 'close chat' : 'open chat'}
      className="sm-floating-chat-trigger"
    >
      <ChatTriggerLabel open={open} pending={pending} />
    </button>
  );
}

function ChatTriggerLabel({ open, pending }: { open: boolean; pending: boolean }) {
  const t = useTranslations('visitor.floatingChatDock');
  return open
    ? <span>{t('close')}</span>
    : pending
      ? <span className="sm-floating-chat-pending">{t('thinking')}<span className="sm-dot">·</span><span className="sm-dot">·</span><span className="sm-dot">·</span></span>
      : <span>{t('ask')}<span className="text-[14px]">›</span></span>;
}

interface PanelProps {
  input: string;
  setInput: (v: string) => void;
  onAsk: (q: string) => void;
  dialogs: ReturnType<typeof useChat>['dialogs'];
  conversationID?: string;
  pending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  // H.13.d ghost text trio; always null in non-code mode.
  ghost: string | null;
  onAcceptGhost: (g: string) => void;
}

function ChatPanel(props: PanelProps) {
  const t = useTranslations('visitor.floatingChatDock');
  return (
    <div
      className="sm-floating-chat-panel sm-rise"
      data-testid="floating-chat-panel"
    >
      <header className="sm-floating-chat-head">
        <span className="sm-smallcaps">{t('askTheAI')}</span>
      </header>
      <div className="sm-floating-chat-transcript sm-floating-chat-compact">
        <FloatingTranscript
          dialogs={props.dialogs} pending={props.pending}
          onAsk={props.onAsk} conversationID={props.conversationID}
        />
        <ChatProgress dialogs={props.dialogs} />
      </div>
      <ChatPanelInput
        value={props.input}
        onChange={props.setInput}
        onSubmit={props.onAsk}
        pending={props.pending}
        inputRef={props.inputRef}
        ghost={props.ghost}
        onAcceptGhost={props.onAcceptGhost}
      />
    </div>
  );
}

// FloatingTranscript —— shows a hint in the empty state; otherwise reuses
// the main chat's ChatTranscript (real md/latex + throbber + citations —
// #35 means no more writing a crude second version).
function FloatingTranscript({ dialogs, pending, onAsk, conversationID }: {
  dialogs: PanelProps['dialogs']; pending: boolean; onAsk: (q: string) => void;
  conversationID?: string;
}) {
  return dialogs.length === 0 && !pending
    ? <EmptyHint />
    : <ChatTranscript dialogs={dialogs} onAsk={onAsk} conversationID={conversationID} />;
}

function EmptyHint() {
  const t = useTranslations('visitor.floatingChatDock');
  return (
    <p className="sm-floating-chat-empty">
      {t('emptyHint')}
    </p>
  );
}

interface ChatPanelInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q: string) => void;
  pending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  ghost: string | null;
  onAcceptGhost: (g: string) => void;
}

function ChatPanelInput(props: ChatPanelInputProps) {
  const ghost = pickGhost({
    value: props.value, blocked: props.pending, ghost: props.ghost,
  });
  const placeholder = ghost ?? 'Ask a follow-up…';
  return (
    <form
      onSubmit={(e) => onSubmit(e, props)}
      className="sm-floating-chat-form"
    >
      <span className="sm-floating-chat-prompt">›</span>
      <ChatPanelInputField
        props={props} ghost={ghost} placeholder={placeholder}
      />
      <ChatPanelInputSubmit value={props.value} />
    </form>
  );
}

function lockedPlaceholder(exhausted: boolean, placeholder: string): string {
  return exhausted ? 'session full' : placeholder;
}

function ChatPanelInputField({ props, ghost, placeholder }: {
  props: ChatPanelInputProps; ghost: string | null; placeholder: string;
}) {
  // Member-level turn budget exhausted → lock the input (consistent with
  // the main composer). Under multi-conversation, `used` is a member-level
  // shared value, so burning through the limit on the dock also locks
  // things here.
  //
  // **This is the only thing that locks**: it doesn't lock while a turn is
  // in flight (F-A-42). A visitor thinking of the next question while
  // waiting for an answer will start typing, and graying out would eat
  // those keystrokes outright; useChat queuing them is the correct
  // behavior (global rule 10). Same as the main composer.
  const exhausted = useIsQuotaExhausted();
  return (
    <input
      ref={props.inputRef}
      type="text"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => dispatchGhostKey(e, ghost, { onAccept: props.onAcceptGhost })}
      placeholder={lockedPlaceholder(exhausted, placeholder)}
      disabled={exhausted}
      data-testid="floating-chat-input"
      className="sm-floating-chat-input"
      autoComplete="off"
      spellCheck={false}
      data-ghost={ghost ?? ''}
    />
  );
}

// Gray out only when there's "nothing written" — pressing while a turn is
// in flight queues it, it's not a failure (F-A-42).
function ChatPanelInputSubmit({ value }: { value: string }) {
  return (
    <button
      type="submit"
      disabled={value.trim() === ''}
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) bg-transparent"
    >
      ↵
    </button>
  );
}

// pending is **no longer a submission gate** (F-A-42): a question sent
// while the previous turn is in flight is queued by useChat and lands in
// the transcript right away. This used to have `&& !props.pending`, which
// silently dropped it — the visitor pressed send, the box cleared, and
// nothing happened.
function onSubmit(
  e: React.FormEvent<HTMLFormElement>,
  props: { value: string; onSubmit: (q: string) => void },
): void {
  e.preventDefault();
  const q = props.value.trim();
  q !== '' && props.onSubmit(q);
}
