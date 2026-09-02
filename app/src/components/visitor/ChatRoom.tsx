// ChatRoom —— the focused chat layout for coded / BYOAI visitors. Design
// source app.js ChatRoom. slim header + ChatWelcome + transcript +
// sticky ChatComposer.

'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

import { composerPlaceholder, pickGhost } from '@/lib/visitor/ghost-text';
import { useCapabilityStore } from '@/lib/visitor/capability-store';
import { useDockButtonsStore } from '@/lib/visitor/dock-buttons-store';
import { dispatchComposerKey, useAutoGrowTextarea } from '@/lib/visitor/composer-keys';
import { composeMessage, useComposerAttachments } from '@/lib/visitor/composer-attachments';
import { AttachmentChips } from '@/components/visitor/ComposerAttachments';
import { GhostText } from '@/components/visitor/GhostText';

import Link from 'next/link';

import { SessionStrip } from '@/components/visitor/SessionStrip';
import { VisitorNamePicker } from '@/components/visitor/VisitorNamePicker';
import { ChatTranscript, ChatProgress } from '@/components/visitor/ChatTranscript';
import { useChatRoomDerived, useChatRoomInput } from '@/lib/visitor/chat-room-state';
import { useConsumeQuestionFromURL } from '@/lib/page/consume-question-url';
import type { SessionMode } from '@/lib/page/use-chat';
import type { PublicOwnerView } from '@/lib/api/public';

type Props = { owner: PublicOwnerView; mode: SessionMode };

export function ChatRoom({ owner, mode }: Props) {
  const derived = useChatRoomDerived();
  const ci = useChatRoomInput(mode);
  // For a visitor who arrived with a question (/gate?q= → through the gate →
  // /?q=): on mount, go ahead and ask that question (don't drop it).
  useConsumeQuestionFromURL(ci.onAsk);
  // Normal-chat behaviour: keep the transcript pinned to the bottom as messages
  // arrive + stream (dialogs is a fresh array each stream tick → fires here),
  // so the newest answer is always in view.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    el && el.scrollTo(0, el.scrollHeight);
  }, [ci.chat.dialogs]);
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
            <ChatComposer
              input={ci.input} setInput={ci.setInput} onSubmit={ci.onAsk}
              pending={ci.chat.pending} exhausted={ci.exhausted}
              showStarters={ci.chat.dialogs.length === 0} mode={derived.mode}
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

const CODED_STARTERS = ['Walk me through your background.', 'What did you actually own at your last role?', 'What’s a take you hold that most peers disagree with?'];
const BYOAI_STARTERS = ['What are you working on right now?', 'How do you think about AI replacing engineers?'];

// ComposerProps —— all the props for ChatRoom's sticky input box. The ghost
// trio was added by H.13.d; only a code-accessor visitor ever receives a
// non-null ghost.
type ComposerProps = {
  input: string; setInput: (v: string) => void; onSubmit: (q: string) => void;
  pending: boolean; exhausted: boolean;
  ghost: string | null; onAcceptGhost: (g: string) => void;
  // handle —— the limit-reached sentence must name the person: the quota was
  // issued by **this person**, and asking for more means going back to them.
  // "contact the owner" is an address-less suggestion to a visitor.
  handle: string;
};

// tryVisible —— don't show TRY while a ghost is present. Both are saying
// "here's what you can ask", but they mean different things: TRY is the
// fixed starters carried by the code (cold-start scaffolding), while ghost
// is generated from **the turn that just happened**. Sitting right next to
// each other in two different visual languages, the visitor just reads
// "there's a pile of suggestions" and can't tell which relates to the last
// turn (UX-35). Once a ghost appears, the scaffolding steps aside.
function tryVisible(showStarters: boolean, ghost: string | null): boolean {
  return showStarters && (ghost === null || ghost === '');
}

function ChatComposer({ showStarters, mode, ...rest }: ComposerProps & { showStarters: boolean; mode: string }) {
  const starters = mode === 'byoai' ? BYOAI_STARTERS : CODED_STARTERS;
  const showTry = tryVisible(showStarters, rest.ghost);
  return (
    <div className="sticky bottom-0 sm-z-dock bg-(--color-paper)/95 backdrop-blur border-t border-(--color-rule) pt-4 pb-5">
      <DockButtons onPick={rest.onSubmit} pending={rest.pending} />
      {showTry && <StarterChips starters={starters} onPick={rest.onSubmit} pending={rest.pending} />}
      <ComposerForm {...rest} />
    </div>
  );
}

function ComposerForm(p: ComposerProps) {
  // blocked only governs the ghost: don't show a hint while a turn is in
  // flight (that hint was generated from the previous turn and is stale by
  // now). **It no longer governs whether the input can be typed into** —
  // see disabled below (F-A-42).
  const blocked = p.pending || p.exhausted;
  const ghost = pickGhost({ value: p.input, blocked, ghost: p.ghost });
  // The ghost **never goes into placeholder** (F-A-25): placeholder doesn't
  // wrap, so a longer hint gets clipped mid-sentence and the visitor can't
  // read it far enough to know what they're being steered toward. It's
  // rendered instead by GhostText as a wrapping overlay layer, and
  // composerPlaceholder blanks the placeholder whenever a ghost is present —
  // rendering both layers would overlap text.
  const placeholder = composerPlaceholder({
    locked: p.exhausted, lockedText: 'session full', ghost, fallback: 'ask…',
  });
  const att = useComposerAttachments();
  const taRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrowTextarea(taRef, p.input);
  // sendComposed —— send it off + clear attachments (clearing the input
  // happens inside onAsk).
  const sendComposed = (msg: string): void => {
    p.onSubmit(msg);
    att.clear();
  };
  // submit —— assemble the final message from the input text + any attached
  // raw text, then send it. Enter and clicking the button go through the
  // same path; the ready guard uses && rather than if (presentation code
  // bans if).
  const submit = (): void => {
    const msg = composeMessage(p.input, att.attachments);
    isComposerReady(msg, p.exhausted) && sendComposed(msg);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="chat-input">
      <AttachmentChips attachments={att.attachments} onRemove={att.remove} />
      {/* Each end stays in its own place (UX-85): `›` marks "writing starts
          here" and belongs to the **first line**; `ASK` means "press this
          when done" and belongs to the **last line**. So the row box aligns
          to the top (pinning the caret), while ASK sinks to the bottom on
          its own via `self-end`. It used to be `items-end` for the whole
          row, so once the text wrapped, the caret got dragged down to the
          end too. With only one line of height the two alignments look
          identical — the bug only surfaces once someone writes a long
          sentence. */}
      <div className="flex items-start gap-4 py-3 border-t border-b border-(--color-ink) relative">
        <span className="text-(--color-accent) font-serif shrink-0 text-[26px] leading-none pt-1">›</span>
        {/* While a ghost is present, GhostText sets this cell's height (it
            wraps), with the textarea floating on top of it; the moment the
            visitor types, pickGhost returns null and the textarea returns to
            normal flow, with useAutoGrowTextarea managing its height.
            **disabled only checks exhausted**: that's the terminal state
            (placeholder will say session full). "the previous turn is still
            answering" is not terminal — a visitor thinking of the next
            question while waiting for an answer is the common case, and the
            product must accept it (global rule 10: accept the request and
            queue it, don't gray it out). It used to be
            `disabled={blocked}`, so a box that looked perfectly ready ate
            every keystroke, for 10–26 seconds at a stretch (F-A-42). */}
        <div className="relative flex-1 min-w-0">
          <textarea
            ref={taRef} rows={1} value={p.input}
            onChange={(e) => p.setInput(e.target.value)}
            onPaste={(e) => { att.onPaste(e); }}
            onKeyDown={(e) => dispatchComposerKey(e, {
              ghost, onSubmit: submit, onAccept: p.onAcceptGhost,
            })}
            placeholder={placeholder}
            disabled={p.exhausted}
            className={ghostClass(ghost)}
            autoComplete="off" spellCheck={false} autoFocus
            data-testid="chat-input-field"
            data-ghost={ghost ?? ''}
          />
          <GhostText text={ghost} />
        </div>
        <ComposerAction exhausted={p.exhausted} />
      </div>
      <LimitLine exhausted={p.exhausted} handle={p.handle} />
    </form>
  );
}

// LimitLine —— when a limit is hit, **say clearly which limit it is, and
// who to talk to next**.
//
// The `session full` label to the right of the input is a tag slot (mono,
// lowercase, must fit on one line) — it can say "stopped" but not "why it
// stopped" or "what to do about it". A visitor who reads only that knows
// they're blocked and nothing else — while this code was issued by the
// owner on purpose, and extending the quota is a one-sentence ask. So the
// full sentence goes below the box; the tag stays on the box's edge.
function LimitLine({ exhausted, handle }: { exhausted: boolean; handle: string }) {
  const t = useTranslations('visitor.chatRoom');
  return exhausted ? (
    <p
      className="mono text-[10.5px] tracking-[0.06em] text-(--color-muted) mt-2"
      data-testid="limit-reached"
    >
      {t('limitReached', { reason: 'turn', handle })}
    </p>
  ) : null;
}

// ghostClass —— while a ghost is present, the textarea is absolutely
// positioned over GhostText (which determines the height); otherwise it
// returns to normal flow and grows its own height. The two typography paths
// must match exactly, or text jumps at the instant a ghost is accepted.
const composerTypography = 'bg-transparent text-(--color-ink) placeholder:text-(--color-faint) '
  + 'font-serif text-[22px] leading-[1.4] font-[380] disabled:opacity-60 resize-none';

function ghostClass(ghost: string | null): string {
  return ghost === null
    ? `w-full ${composerTypography}`
    : `absolute inset-0 w-full h-full ${composerTypography}`;
}

// isComposerReady —— whether it can be sent. **pending is not in the
// criteria** (F-A-42): a question sent while the previous turn is in flight
// is queued by `useChat` and lands in the transcript right away, no longer
// silently dropped. `exhausted` still blocks, because that's terminal.
function isComposerReady(msg: string, exhausted: boolean): boolean {
  return msg.trim() !== '' && !exhausted;
}

function ComposerAction({ exhausted }: { exhausted: boolean }) {
  const t = useTranslations('visitor.chatRoom');
  return exhausted ? (
    <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent) shrink-0 self-end pb-1">{t('sessionFull')}</span>
  ) : (
    // **Not grayed out** while the previous turn is in flight: pressing it
    // queues the question and it lands in the transcript right away, so it
    // stays "Ask" (F-A-42). Graying out is reserved for the session-full
    // branch above.
    <button type="submit"
      className="mono text-[11.5px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) transition-colors shrink-0 self-end pb-1">
      {t.rich('ask', { big: (c) => <span className="text-[14px]">{c}</span> })}
    </button>
  );
}

function StarterChips({ starters, onPick, pending }: {
  starters: readonly string[]; onPick: (q: string) => void; pending: boolean;
}) {
  const t = useTranslations('visitor.common');
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-2 mb-3 overflow-x-auto" data-testid="starter-chips">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mr-3 shrink-0 pt-0.5">{t('try')}</span>
      {starters.map((q, i) => (
        <StarterChip key={q} q={q} last={i === starters.length - 1} onPick={onPick} pending={pending} />
      ))}
    </div>
  );
}

function StarterChip({ q, last, onPick, pending }: { q: string; last: boolean; onPick: (q: string) => void; pending: boolean }) {
  return (
    <span>
      <button type="button" onClick={() => onPick(q)} disabled={pending}
        className="font-serif italic text-(--color-muted) hover:text-(--color-accent) transition-colors text-left disabled:opacity-50 shrink-0 text-[14.5px] leading-[1.4]">
        &ldquo;{q}&rdquo;
      </button>
      {!last && <span className="text-(--color-faint) not-italic mx-2">/</span>}
    </span>
  );
}

// ── dock buttons (#109/#110) ─────────────────────────────────
// ≤2 shortcut buttons the owner configures on a role. Clicking = send the
// owner-written "trigger phrase" as a visitor message (the same path as
// typing, the same path the owner uses to invoke it in their own UI — the
// button is just a shortcut). ACL disables the capability → grayed out.

function DockButtons({ onPick, pending }: { onPick: (q: string) => void; pending: boolean }) {
  const buttons = useDockButtonsStore((s) => s.buttons);
  const caps = useCapabilityStore((s) => s.states);
  return buttons.length === 0 ? null : (
    <div className="flex flex-wrap gap-2 mb-3" data-testid="dock-buttons">
      {buttons.map((b) => (
        <DockButton
          key={b.capability_id}
          capabilityId={b.capability_id}
          title={b.title}
          trigger={b.trigger}
          state={capState(caps, b.capability_id)}
          onPick={onPick}
          pending={pending}
        />
      ))}
    </div>
  );
}

type DockCapState = { enabled: boolean; reason: string };

function DockButton({
  capabilityId, title, trigger, state, onPick, pending,
}: {
  capabilityId: string;
  title: string;
  trigger: string;
  state: DockCapState;
  onPick: (q: string) => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      disabled={pending || !state.enabled}
      onClick={() => onPick(trigger)}
      data-testid={`dock-button-${capabilityId}`}
      title={state.enabled ? undefined : state.reason}
      className="mono text-[11px] tracking-[0.06em] px-3 py-1.5 border border-(--color-rule) text-(--color-ink) hover:border-(--color-ink) disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {title}
    </button>
  );
}

// capState —— read a capability's enabled/disabled reason from the
// capability store. Not found (this session lacks the capability) → disabled.
function capState(
  caps: readonly { id: string; enabled: boolean; policy_summary?: string }[],
  id: string,
): DockCapState {
  const c = caps.find((x) => x.id === id);
  return c
    ? { enabled: c.enabled, reason: c.policy_summary ?? 'unavailable right now' }
    : { enabled: false, reason: 'unavailable right now' };
}

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
