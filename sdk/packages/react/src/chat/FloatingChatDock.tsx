// FloatingChatDock —— lets a visitor chat without leaving the page, from
// any surface (blog/wiki/output, a microsite on a phone). collapsed = the pill
// button in the bottom-right corner; expanded = the floating panel (transcript +
// the one Composer).
//
// Multi-conversation model: the dock passes docContext, and useChat uses it to
// lazily resolve **this member's own** conversation on this doc (POST
// /conversations, independent of the main chat) — transcripts don't
// cross-contaminate. The member (name) and the turn quota are shared;
// "cross-awareness" comes from the backend injecting all of that member's
// conversations into the instruction, so this thread can answer using things
// discussed elsewhere.
//
// SSR-safe: every zustand / fetch / WebStorage call runs only after mount.
// **The pill doesn't render in public mode**: nobody is paying for inference.
// It shows only in byoai / code mode.

'use client';

import { useState } from 'react';
import type { DocContext } from '@standmeet/agent-core';

import { useChatT } from '../i18n.js';
import type { SessionMode } from './use-chat.js';
import { ChatTranscript, ChatProgress } from './ChatTranscript.js';
import { Composer } from './Composer.js';
import { useChatController } from './chat-controller.js';
import { useVisitorSessionStore, useVisitorChatAvailable } from './session-store.js';

type Controller = ReturnType<typeof useChatController>;

// docContext —— the doc the visitor is currently on, so the AI can resolve
// "this/this article/this project" (#36). Whether the pill renders reads the
// same criterion as the reader's about-card (`useVisitorChatAvailable`, UX-86).
export function FloatingChatDock({ docContext }: { docContext?: DocContext }) {
  const canAsk = useVisitorChatAvailable();
  const mode = useModeFromVisitorStore();
  return canAsk ? <OwnDock mode={mode} docContext={docContext} /> : null;
}

function OwnDock({ mode, docContext }: { mode: SessionMode; docContext?: DocContext }) {
  const ci = useChatController(mode, docContext);
  return <DockPanel ci={ci} handle="" starters={[]} />;
}

// DockPanel —— the pill + panel around a conversation someone else holds: the app's reader pages
// (above) and a microsite agent on a narrow screen (Agent) both render this one.
export function DockPanel({ ci, handle, starters, placeholder, head }: {
  ci: Controller; handle: string; starters: readonly string[]; placeholder?: string;
  head?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ChatTrigger open={open} onToggle={() => setOpen((o) => !o)} pending={ci.chat.pending} />
      {open && (
        <div className="sm-floating-chat-panel sm-rise" data-testid="floating-chat-panel">
          <PanelHead extra={head} />
          <div className="sm-floating-chat-transcript sm-floating-chat-compact">
            {ci.chat.dialogs.length === 0 && !ci.chat.pending
              ? <EmptyHint />
              : (
                <ChatTranscript
                  dialogs={ci.chat.dialogs} onAsk={ci.onAsk}
                  conversationID={ci.chat.conversationID} noteEvent={ci.chat.noteEvent}
                />
              )}
            <ChatProgress dialogs={ci.chat.dialogs} />
          </div>
          <div className="sm-floating-chat-form">
            <Composer
              variant="dock" autoFocus
              input={ci.input} setInput={ci.setInput} onSubmit={ci.onAsk}
              pending={ci.chat.pending} exhausted={ci.exhausted}
              ghost={ci.ghost} onAcceptGhost={ci.onAcceptGhost}
              handle={handle} placeholder={placeholder ?? 'Ask a follow-up…'}
              showStarters={ci.chat.dialogs.length === 0} starters={starters}
            />
          </div>
        </div>
      )}
    </>
  );
}

// useModeFromVisitorStore —— derives mode from the visitor-session store.
// A fresh visitor with no session → 'public' (pill doesn't render).
function useModeFromVisitorStore(): SessionMode {
  const session = useVisitorSessionStore((s) => s.session);
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
  const t = useChatT('dock');
  return open
    ? <span>{t('close')}</span>
    : pending
      ? <span className="sm-floating-chat-pending">{t('thinking')}<span className="sm-dot">·</span><span className="sm-dot">·</span><span className="sm-dot">·</span></span>
      : <span>{t('ask')}<span className="smc-dock-caret">›</span></span>;
}

function PanelHead({ extra }: { extra?: React.ReactNode }) {
  const t = useChatT('dock');
  return (
    <header className="sm-floating-chat-head">
      <span className="smc-dock-title">{t('askTheAI')}</span>
      {extra}
    </header>
  );
}

function EmptyHint() {
  const t = useChatT('dock');
  return <p className="sm-floating-chat-empty">{t('emptyHint')}</p>;
}
