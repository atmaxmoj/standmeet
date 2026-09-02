// AskInput —— the "Ask anything." input bar in the Hero. `›` large accent caret +
// 1.5px ink borders above and below + "ask ↵" mono hint on the right. The visitor's
// first interactive element.
//
// Controlled: value/onChange are owned by the parent; submit goes through
// onSubmit(value). While disabled, the input + button both dim to avoid
// duplicate sends and to signal "thinking" visually.
//
// H.13.d: ghost is the grey ghost text currently due to render (given by the
// backend as ghosts[0] when a code-accessor visitor arrives, appended each
// round after the AI finishes a follow-up frame; null in every other mode).
// Renders when input is empty and not disabled/locked. **Tab** →
// onAcceptGhost(ghost) fills it into the input without auto-submitting;
// **Esc** → onCycleGhost() advances to the next one. Typing anything
// naturally covers the ghost with the real value.

'use client';

import type { FormEvent, RefObject } from 'react';
import { useTranslations } from 'next-intl';

import { dispatchGhostKey, pickGhost, pickPlaceholder } from '@/lib/visitor/ghost-text';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q: string) => void;
  disabled: boolean;
  // lockedReason —— quota exhausted / other long-term lock. When set, the
  // input dims and the "ask ↵" on the right becomes the lockedReason text;
  // the chat input can't submit at all.
  // Unset = null → falls through to the transient `disabled` (pending) logic.
  lockedReason?: string | null;
  inputRef?: RefObject<HTMLInputElement | null>;
  // H.13.d ghost text trio; omit to turn the whole ghost feature off.
  ghost?: string | null;
  onAcceptGhost?: (ghost: string) => void;
  // testid —— **what this box is called** (F-Q-3). This same component is
  // used in two places: the homepage one (no session yet — Enter hands off
  // to /gate) and the in-session one (Enter sends this turn). When both
  // instances share one name, anything looking a control up by name can't
  // tell which one it hit, and the wrong hit looks **exactly like the
  // product being broken** — it has already fooled two real-environment
  // drives. The in-session one omits this and takes the default.
  testid: string;
};

export function AskInput(props: Props) {
  const locked = isLocked(props);
  return (
    <form onSubmit={(e) => onAskSubmit(e, props)} data-testid="chat-input">
      <div className="flex items-baseline gap-4 py-4 border-t-[1.5px] border-b-[1.5px] border-(--color-ink) relative">
        <AskPrompt />
        <AskField props={props} locked={locked} />
        <AskAction props={props} locked={locked} />
      </div>
    </form>
  );
}

function AskPrompt() {
  return (
    <span className="text-(--color-accent) font-serif shrink-0 text-[28px] leading-none">›</span>
  );
}

function AskField({ props, locked }: { props: Props; locked: boolean }) {
  const blocked = props.disabled || locked;
  const ghost = pickGhost({ value: props.value, blocked, ghost: props.ghost });
  const placeholder = pickPlaceholder({
    locked, lockedText: 'session full', ghost, fallback: 'Ask anything.',
  });
  return (
    <input
      ref={props.inputRef}
      type="text"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => dispatchGhostKey(e, ghost, {
        onAccept: (g) => props.onAcceptGhost?.(g),
      })}
      placeholder={placeholder}
      disabled={blocked}
      className="flex-1 bg-transparent text-(--color-ink) placeholder:text-(--color-faint) font-serif min-w-0 text-[clamp(20px,2.2vw,26px)] leading-[1.3] font-[380] disabled:opacity-60"
      autoComplete="off"
      spellCheck={false}
      data-testid={props.testid}
      data-ghost={ghost ?? ''}
    />
  );
}

function isLocked(props: Props): boolean {
  return (props.lockedReason ?? null) !== null;
}

function AskAction({ props, locked }: { props: Props; locked: boolean }) {
  const t = useTranslations('page');
  return locked ? (
    <span
      className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent) shrink-0 pt-1"
      data-testid="chat-input-locked"
    >
      {props.lockedReason}
    </span>
  ) : (
    <button
      type="submit"
      disabled={props.disabled || props.value.trim() === ''}
      className="mono text-[11.5px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) transition-colors shrink-0 pt-1"
    >
      {t('askInput.ask')} <span className="text-[14px]">↵</span>
    </button>
  );
}

function onAskSubmit(e: FormEvent<HTMLFormElement>, props: Props): void {
  e.preventDefault();
  const q = props.value.trim();
  isReadyToSubmit(q, props) && props.onSubmit(q);
}

function isReadyToSubmit(q: string, props: Props): boolean {
  return q !== '' && !props.disabled && !isLocked(props);
}
