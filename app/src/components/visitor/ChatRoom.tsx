// ChatRoom —— the focused chat layout for coded / BYOAI visitors. Design
// source app.js ChatRoom. slim header + ChatWelcome + transcript +
// sticky ChatComposer.

'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  ChatProgress, ChatTranscript, Composer, tryVisible, useChatController, useChatRoomDerived,
  usePinToBottom, type SessionMode,
} from '@standmeet/sdk';

import { SessionStrip } from '@/components/visitor/SessionStrip';
import { VisitorNamePicker } from '@/components/visitor/VisitorNamePicker';
import { useConsumeQuestionFromURL } from '@/lib/page/consume-question-url';
import type { PublicOwnerView } from '@/lib/api/public';

type Props = { owner: PublicOwnerView; mode: SessionMode };

export function ChatRoom({ owner, mode }: Props) {
  const derived = useChatRoomDerived();
  const ci = useChatController(mode);
  // For a visitor who arrived with a question (/gate?q= → through the gate →
  // /?q=): on mount, go ahead and ask that question (don't drop it).
  useConsumeQuestionFromURL(ci.onAsk);
  const scrollRef = usePinToBottom<HTMLDivElement>(ci.chat.dialogs);
  return (
    <div className="h-screen flex flex-col overflow-hidden" data-testid="chatroom">
      <SessionStrip
        leading={<BrandMark handle={owner.handle} />}
        trailing={<FullPageLink />}
      />
      <VisitorNamePicker />
      <main className="flex-1 flex flex-col min-h-0">
        <div className="max-w-[760px] w-full mx-auto px-6 lg:px-0 flex-1 flex flex-col min-h-0">
          {/* scroll area: welcome + transcript scroll here; composer stays docked */}
          {/* sm-scroll-read: reserves space on the right for the scrollbar. An
              overlay scrollbar, while showing, clips the last character of
              each line ("does a" / "should"), and this column is long serif
              prose (UX-71). */}
          <div ref={scrollRef} className="sm-scroll-read flex-1 min-h-0">
            {/* The welcome copy and the input area read the **same** showTry:
                the "way in" line refers to whether TRY renders below it.
                Computing them separately would eventually go out of sync. */}
            <ChatWelcome
              owner={owner} d={derived}
              hasDialogs={ci.chat.dialogs.length > 0}
              showTry={tryVisible(ci.chat.dialogs.length === 0, ci.ghost)}
            />
            <ChatTranscript
              dialogs={ci.chat.dialogs} onAsk={ci.onAsk}
              conversationID={ci.chat.conversationID}
              noteEvent={ci.chat.noteEvent}
            />
          </div>
          {/* docked bottom: progress + composer + footnote stay pinned to the viewport */}
          <div className="shrink-0 bg-(--color-paper)">
            <ChatProgress dialogs={ci.chat.dialogs} />
            <Composer
              autoFocus
              input={ci.input} setInput={ci.setInput} onSubmit={ci.onAsk}
              pending={ci.chat.pending} exhausted={ci.exhausted}
              showStarters={ci.chat.dialogs.length === 0}
              starters={derived.mode === 'byoai' ? BYOAI_STARTERS : CODED_STARTERS}
              ghost={ci.ghost} onAcceptGhost={ci.onAcceptGhost}
              handle={owner.handle}
            />
            <ChatFootnote handle={owner.handle} mode={derived.mode} />
          </div>
        </div>
      </main>
    </div>
  );
}

// ── header ──────────────────────────────────────────────────
//
// This screen used to stack a full-width header **on top of** the session
// strip. Both bars were full-width, both were small mono text, and each drew
// its own live dot — one for this conversation, one for the site — adding
// up to a 68px header blocking the content (UX-53). Site identity and
// `FULL PAGE →` now hang off two slots on the session strip itself, so one
// bar says both things, and only one live dot remains (the session strip's).

function BrandMark({ handle }: { handle: string }) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <span className="inline-flex items-baseline gap-2 mr-1">
      <span className="text-(--color-ink)">{t('brand')}</span>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-muted)">{handle}</span>
      <span className="text-(--color-faint)">·</span>
    </span>
  );
}

function FullPageLink() {
  const t = useTranslations('visitor.chatRoom');
  return (
    <Link href="/" className="sm-session-strip-link">
      {t('fullPage')}
    </Link>
  );
}

// ── welcome ────────────────────────────────────────────────

// An empty session doesn't draw the rule below the welcome copy. With a
// transcript it's a "welcome copy ends here" divider; without one, it would
// pair with the rule at the top of the input area to frame the space in
// between as a **bordered empty box** — which reads not as "no content
// here yet" but as "something failed to load" (UX-72).
function ChatWelcome({ owner, d, hasDialogs, showTry }: {
  owner: PublicOwnerView; d: ReturnType<typeof useChatRoomDerived>;
  hasDialogs: boolean; showTry: boolean;
}) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <article
      className={`pt-10 pb-10 ${hasDialogs ? 'border-b border-(--color-rule)' : ''}`}
      data-testid="chat-welcome"
    >
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
        {t('ready', { handle: owner.handle })}
      </div>
      <div className="reading text-(--color-ink) text-[17px] max-w-[54ch]">
        {d.mode === 'coded'
          ? <CodedWelcome handle={owner.handle} visitor={d.visitor} codeLabel={d.codeLabel} showTry={showTry} />
          : <ByoaiWelcome handle={owner.handle} provider={d.provider} />}
      </div>
    </article>
  );
}

const accentTag = (c: React.ReactNode) => <span className="text-(--color-accent)">{c}</span>;

// CodedWelcome —— the closing sentence must describe **something that's
// actually on screen**.
//
// It used to say unconditionally "Starters below if you need a way in.",
// while the row of TRY chips collapses whenever a ghost is present (UX-35:
// two sets of suggestions on the same screen leave the visitor unable to
// tell which one relates to the last turn). So in the most common case —
// the code itself carries a suggested question → there's a ghost on the
// first turn — the welcome copy pointed at something that didn't exist,
// while the real suggestion sat right there in the input, with no text
// saying it could be taken with Tab (which is exactly what UX-34 records).
function CodedWelcome({ handle, visitor, codeLabel, showTry }: {
  handle: string; visitor: string | null; codeLabel: string; showTry: boolean;
}) {
  const t = useTranslations('visitor.chatRoom');
  const greeting = visitor ? `Hi, ${visitor.split(' ')[0]}` : 'Hi';
  return (
    <>
      <p>{t.rich('codedWelcome', { greeting, handle, codeLabel, accent: accentTag })}</p>
      <p className="mt-4">{t('codedRedaction', { handle })}</p>
      <p className="mt-4" data-testid="welcome-way-in">
        {showTry ? t('codedStarters') : t('codedGhostHint')}
      </p>
    </>
  );
}

function ByoaiWelcome({ handle, provider }: { handle: string; provider: string }) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <>
      <p>{t.rich('byoaiWelcome', { handle, provider, accent: accentTag })}</p>
      <p className="mt-4">{t('byoaiScope')}</p>
    </>
  );
}


// ── composer ───────────────────────────────────────────────
// The input itself is the SDK's one Composer (every chat surface renders it); the room supplies
// only its cold-start starters.

const CODED_STARTERS = ['Walk me through your background.', 'What did you actually own at your last role?', 'What’s a take you hold that most peers disagree with?'];
const BYOAI_STARTERS = ['What are you working on right now?', 'How do you think about AI replacing engineers?'];

// ── footnote ───────────────────────────────────────────────

function ChatFootnote({ handle, mode }: { handle: string; mode: string }) {
  const t = useTranslations('visitor.chatRoom');
  return (
    <p className="mono text-[10px] leading-[1.7] text-(--color-faint) mt-3 mb-10">
      {t.rich('footnote', {
        handle,
        muted: (c) => <span className="text-(--color-muted)">{c}</span>,
      })}
      {mode === 'coded' && t('footnoteCoded', { handle })}
      {mode === 'byoai' && t('footnoteByoai')}
    </p>
  );
}
