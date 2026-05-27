// ChatRoom —— coded / BYOAI visitor 的 focused chat layout。design 源
// app.js ChatRoom (826-913)。slim header + ChatWelcome + transcript +
// sticky ChatComposer。

'use client';

import { useRef } from 'react';

import Link from 'next/link';

import { SessionStrip } from '@/components/visitor/SessionStrip';
import { VisitorNamePicker } from '@/components/visitor/VisitorNamePicker';
import { useChatRoomDerived, useChatRoomInput } from '@/lib/visitor/chat-room-state';
import type { Citation, SessionTier } from '@/lib/page/use-conversation';
import type { PublicOwnerView } from '@/lib/api/public';

type Props = { owner: PublicOwnerView; tier: SessionTier };

export function ChatRoom({ owner, tier }: Props) {
  const derived = useChatRoomDerived();
  const { conv, exhausted, input, setInput, onAsk } = useChatRoomInput(tier);
  return (
    <div className="min-h-screen flex flex-col" data-testid="chatroom">
      <SessionStrip />
      <VisitorNamePicker />
      <ChatRoomHeader handle={owner.handle} hasConv={conv.turns.length > 0} onReset={conv.reset} />
      <main className="flex-1 flex flex-col">
        <div className="max-w-[760px] w-full mx-auto px-6 lg:px-0 flex-1 flex flex-col">
          <ChatWelcome owner={owner} d={derived} />
          <ChatTranscript turns={conv.turns} />
          <ChatComposer
            input={input} setInput={setInput} onSubmit={onAsk}
            pending={conv.pending} exhausted={exhausted}
            showStarters={conv.turns.length === 0} mode={derived.mode}
          />
          <ChatFootnote handle={owner.handle} mode={derived.mode} />
        </div>
      </main>
    </div>
  );
}

// ── header ──────────────────────────────────────────────────

function ChatRoomHeader({ handle, hasConv, onReset }: { handle: string; hasConv: boolean; onReset: () => void }) {
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 py-3 border-b border-(--color-rule) shrink-0 gap-4 sticky top-0 bg-(--color-paper)/95 backdrop-blur z-20">
      <HeaderLeft handle={handle} />
      <HeaderRight hasConv={hasConv} onReset={onReset} />
    </header>
  );
}

function HeaderLeft({ handle }: { handle: string }) {
  return (
    <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3 shrink-0">
      <span className="text-(--color-ink)">standmeet</span>
      <span className="text-(--color-faint)">/</span>
      <span className="text-(--color-muted)">{handle}</span>
      <span className="ml-2 inline-flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) sm-live-dot" />
        <span className="text-(--color-faint) text-[10px] tracking-[0.16em]">live</span>
      </span>
    </div>
  );
}

function HeaderRight({ hasConv, onReset }: { hasConv: boolean; onReset: () => void }) {
  return (
    <div className="flex items-center gap-5 shrink-0">
      {hasConv && (
        <button type="button" onClick={onReset}
          className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors">
          ↺ reset
        </button>
      )}
      <Link href="/" className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) transition-colors">
        full page →
      </Link>
    </div>
  );
}

// ── welcome ────────────────────────────────────────────────

function ChatWelcome({ owner, d }: { owner: PublicOwnerView; d: ReturnType<typeof useChatRoomDerived> }) {
  return (
    <article className="pt-10 pb-10 border-b border-(--color-rule)" data-testid="chat-welcome">
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">
        {owner.handle}&apos;s ai · ready
      </div>
      <div className="reading text-(--color-ink) text-[17px] max-w-[54ch]">
        {d.mode === 'coded'
          ? <CodedWelcome handle={owner.handle} visitor={d.visitor} codeLabel={d.codeLabel} />
          : <ByoaiWelcome handle={owner.handle} provider={d.provider} />}
      </div>
    </article>
  );
}

function CodedWelcome({ handle, visitor, codeLabel }: { handle: string; visitor: string | null; codeLabel: string }) {
  const greeting = visitor ? `Hi, ${visitor.split(' ')[0]}` : 'Hi';
  return (
    <>
      <p>{greeting}. I&apos;m an AI grounded in {handle}&apos;s curated corpus.
        You&apos;ve come in on the <span className="text-(--color-accent)">{codeLabel}</span> slice.</p>
      <p className="mt-4">Private topics outside this code&apos;s scope are redacted. {handle} reads transcripts afterward.</p>
      <p className="mt-4">Ask anything. Starters below if you need a way in.</p>
    </>
  );
}

function ByoaiWelcome({ handle, provider }: { handle: string; provider: string }) {
  return (
    <>
      <p>Hi. I&apos;m an AI grounded in {handle}&apos;s curated corpus. You&apos;re running
        on your own <span className="text-(--color-accent)">{provider}</span> key — public slice only.</p>
      <p className="mt-4">Work, projects, public takes — fair game. Private topics return a &ldquo;need a code&rdquo; response.</p>
    </>
  );
}

// ── transcript ─────────────────────────────────────────────

type Turn = ReturnType<typeof useChatRoomInput>['conv']['turns'][number];

function ChatTranscript({ turns }: { turns: readonly Turn[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  return (
    <div className="flex-1">
      {turns.map((t, i) => <ChatTurn key={t.id ?? i} turn={t} />)}
      <div ref={endRef} />
    </div>
  );
}

function ChatTurn({ turn }: { turn: Turn }) {
  return (
    <article className="pt-10 pb-10 border-b border-(--color-rule)">
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase mb-3 flex items-baseline gap-3">
        <span className="text-(--color-ink)">you</span>
      </div>
      <p className="font-serif italic text-[22px] leading-[1.3] font-[380] tracking-[-0.003em] mb-7">
        {turn.q}
      </p>
      {turn.pending ? <ThinkingDots /> : <TurnAnswer answer={turn.answer} />}
    </article>
  );
}

function ThinkingDots() {
  return (
    <div className="mono text-(--color-muted) text-[11px] tracking-[0.18em] uppercase mt-3" data-testid="answer-pending">
      retrieving <span className="sm-dot">·</span><span className="sm-dot">·</span><span className="sm-dot">·</span>
    </div>
  );
}

function TurnAnswer({ answer }: { answer: Turn['answer'] }) {
  return answer ? (
    <div data-testid="answer-body">
      <div className="mono text-[10.5px] tracking-[0.18em] uppercase text-(--color-accent) mb-3">ai</div>
      {answer.paras.map((p, i) => (
        <p key={i} className="reading mb-4 last:mb-0 text-[18px]">{p}</p>
      ))}
      <TurnCitations citations={answer.citations} />
    </div>
  ) : null;
}

function TurnCitations({ citations }: { citations?: readonly Citation[] }) {
  return citations && citations.length > 0 ? (
    <div className="mt-6" data-testid="citations">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">drawn from</div>
      <ul className="flex flex-col gap-1">
        {citations.map((c) => (
          <li key={c.id} className="mono text-[11px] text-(--color-muted)">
            {c.kind} · {c.title}
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}

// ── composer ───────────────────────────────────────────────

const CODED_STARTERS = ['Walk me through your background.', 'What did you actually own at your last role?', 'What’s a take you hold that most peers disagree with?'];
const BYOAI_STARTERS = ['What are you working on right now?', 'How do you think about AI replacing engineers?'];

function ChatComposer({ input, setInput, onSubmit, pending, exhausted, showStarters, mode }: {
  input: string; setInput: (v: string) => void; onSubmit: (q: string) => void;
  pending: boolean; exhausted: boolean; showStarters: boolean; mode: string;
}) {
  const starters = mode === 'byoai' ? BYOAI_STARTERS : CODED_STARTERS;
  return (
    <div className="sticky bottom-0 z-30 bg-(--color-paper)/95 backdrop-blur border-t border-(--color-rule) pt-4 pb-5">
      {showStarters && <StarterChips starters={starters} onPick={onSubmit} pending={pending} />}
      <ComposerForm input={input} setInput={setInput} onSubmit={onSubmit} pending={pending} exhausted={exhausted} />
    </div>
  );
}

function ComposerForm({ input, setInput, onSubmit, pending, exhausted }: {
  input: string; setInput: (v: string) => void; onSubmit: (q: string) => void;
  pending: boolean; exhausted: boolean;
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); handleComposerSubmit(input, pending, exhausted, onSubmit); }} data-testid="chat-input">
      <div className="flex items-baseline gap-4 py-3 border-t border-b border-(--color-ink) relative">
        <span className="text-(--color-accent) font-serif shrink-0 text-[26px] leading-none">›</span>
        <input
          type="text" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder={exhausted ? 'session full' : 'ask…'}
          disabled={pending || exhausted}
          className="flex-1 bg-transparent text-(--color-ink) placeholder:text-(--color-faint) font-serif min-w-0 text-[22px] leading-[1.3] font-[380] disabled:opacity-60"
          autoComplete="off" spellCheck={false} autoFocus
        />
        <ComposerAction pending={pending} exhausted={exhausted} />
      </div>
    </form>
  );
}

function isComposerReady(input: string, pending: boolean, exhausted: boolean): boolean {
  return input.trim() !== '' && !pending && !exhausted;
}

function handleComposerSubmit(input: string, pending: boolean, exhausted: boolean, onSubmit: (q: string) => void): void {
  isComposerReady(input, pending, exhausted) && onSubmit(input.trim());
}

function ComposerAction({ pending, exhausted }: { pending: boolean; exhausted: boolean }) {
  return exhausted ? (
    <span className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent) shrink-0 pt-1">session full</span>
  ) : (
    <button type="submit" disabled={pending}
      className="mono text-[11.5px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) transition-colors shrink-0 pt-1">
      ask <span className="text-[14px]">↵</span>
    </button>
  );
}

function StarterChips({ starters, onPick, pending }: {
  starters: readonly string[]; onPick: (q: string) => void; pending: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-1 gap-y-2 mb-3 overflow-x-auto" data-testid="starter-chips">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-faint) mr-3 shrink-0 pt-0.5">try</span>
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

// ── footnote ───────────────────────────────────────────────

function ChatFootnote({ handle, mode }: { handle: string; mode: string }) {
  return (
    <p className="mono text-[10px] leading-[1.7] text-(--color-faint) mt-3 mb-10">
      <span className="text-(--color-muted)">how this works</span> · answers come from {handle}&apos;s curated corpus.
      private topics return a redaction rather than a guess.
      {mode === 'coded' && <> {handle} reads the transcript afterward.</>}
      {mode === 'byoai' && <> your api key never leaves the browser.</>}
    </p>
  );
}
