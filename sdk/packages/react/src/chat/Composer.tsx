// Composer —— the one chat input: the app room, the floating dock, a microsite rail and the embed
// all render this, so what the input does (queue while a turn runs, take the ghost with Tab, fold
// a long paste into an attachment, lock at the quota) is the same everywhere. Moved from the app's
// ChatRoom, where it was written.

'use client';

import { useRef } from 'react';

import { useChatT } from '../i18n.js';
import { composerPlaceholder, pickGhost } from './ghost-text.js';
import { useBlockStore } from './block-store.js';
import { useDockButtonsStore } from './dock-buttons-store.js';
import { dispatchComposerKey, useAutoGrowTextarea } from './composer-keys.js';
import { composeMessage, useComposerAttachments } from './composer-attachments.js';
import { AttachmentChips } from './ComposerAttachments.js';
import { GhostText } from './GhostText.js';
import { appendSpoken, clock, useVoiceInput, type VoiceInput } from './use-voice-input.js';

// ComposerProps —— the input's state lives in the caller (useChatController), so a layout can
// put the progress line, the transcript and this input wherever it wants.
export type ComposerProps = {
  input: string; setInput: (v: string) => void; onSubmit: (q: string) => void;
  pending: boolean; exhausted: boolean;
  ghost: string | null; onAcceptGhost: (g: string) => void;
  // handle —— the limit-reached sentence must name the person: the quota was
  // issued by **this person**, and asking for more means going back to them.
  // "contact the owner" is an address-less suggestion to a visitor.
  handle: string;
  // placeholder —— the page's own prompt (a microsite passes its copy); the room's is "ask…".
  placeholder?: string;
  // variant —— room: the chat page's input, sticky at the bottom (default). dock: the floating
  // panel and the rail, smaller type. inline: in a page's flow, where the author put it.
  variant?: 'room' | 'dock' | 'inline';
  // autoFocus —— the room is a chat page, so the caret starts in the input; a reading page's
  // rail must not steal focus from the letter.
  autoFocus?: boolean;
};

// tryVisible —— don't show TRY while a ghost is present. Both are saying
// "here's what you can ask", but they mean different things: TRY is the
// fixed starters carried by the code (cold-start scaffolding), while ghost
// is generated from **the turn that just happened**. Sitting right next to
// each other in two different visual languages, the visitor just reads
// "there's a pile of suggestions" and can't tell which relates to the last
// turn (UX-35). Once a ghost appears, the scaffolding steps aside.
export function tryVisible(showStarters: boolean, ghost: string | null): boolean {
  return showStarters && (ghost === null || ghost === '');
}

export function Composer({ showStarters, starters, ...rest }: ComposerProps & {
  showStarters: boolean; starters: readonly string[];
}) {
  const showTry = tryVisible(showStarters, rest.ghost) && starters.length > 0;
  return (
    <div className={`smc-composer is-${rest.variant ?? 'room'}`}>
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
  const t = useChatT('composer');
  // The ghost **never goes into placeholder** (F-A-25): placeholder doesn't
  // wrap, so a longer hint gets clipped mid-sentence and the visitor can't
  // read it far enough to know what they're being steered toward. It's
  // rendered instead by GhostText as a wrapping overlay layer, and
  // composerPlaceholder blanks the placeholder whenever a ghost is present —
  // rendering both layers would overlap text.
  const placeholder = composerPlaceholder({
    locked: p.exhausted, lockedText: t('sessionFull'), ghost, fallback: p.placeholder ?? t('placeholder'),
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
  // voice —— a spoken question is sent the moment it is transcribed (owner 2026-10-02: "自动识别
  // 断句自行发送"), joined to anything already typed. A locked session keeps it in the box.
  const voice = useVoiceInput((spoken) => {
    const text = appendSpoken(p.input, spoken);
    return isComposerReady(text, p.exhausted)
      ? sendComposed(composeMessage(text, att.attachments))
      : p.setInput(text);
  });
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
          its own via `self-end`. */}
      <div className="smc-composer-row">
        <span className="smc-composer-prompt">›</span>
        {/* While a ghost is present, GhostText sets this cell's height (it
            wraps), with the textarea floating on top of it; the moment the
            visitor types, pickGhost returns null and the textarea returns to
            normal flow, with useAutoGrowTextarea managing its height.
            **disabled only checks exhausted**: "the previous turn is still
            answering" is not terminal — the product accepts the question
            and queues it (global rule 10; F-A-42). */}
        <div className="smc-composer-cell">
          <textarea
            ref={taRef} rows={1} value={p.input}
            onChange={(e) => p.setInput(e.target.value)}
            onPaste={(e) => { att.onPaste(e); }}
            onKeyDown={(e) => dispatchComposerKey(e, {
              ghost, onSubmit: submit, onAccept: p.onAcceptGhost,
            })}
            placeholder={placeholder}
            disabled={p.exhausted}
            className={ghost === null ? 'smc-composer-input' : 'smc-composer-input is-over-ghost'}
            autoComplete="off" spellCheck={false} autoFocus={p.autoFocus === true}
            data-testid="chat-input-field"
            data-ghost={ghost ?? ''}
          />
          <GhostText text={ghost} />
        </div>
        <MicButton voice={voice} />
        <ComposerAction exhausted={p.exhausted} />
      </div>
      <VoiceLine voice={voice} />
      <LimitLine exhausted={p.exhausted} handle={p.handle} />
    </form>
  );
}

// LimitLine —— when a limit is hit, **say clearly which limit it is, and
// who to talk to next**. The `session full` tag on the box can say "stopped"
// but not "why" or "what to do about it"; the full sentence goes below.
function LimitLine({ exhausted, handle }: { exhausted: boolean; handle: string }) {
  const t = useChatT('composer');
  return exhausted ? (
    <p
      className="smc-limit"
      data-testid="limit-reached"
    >
      {t('limitReached', { reason: 'turn', handle })}
    </p>
  ) : null;
}

// MicButton —— offered only when the instance has a speech service and the browser can record.
// Press to record, press again to stop; while the recording is turned into text it waits.
function MicButton({ voice }: { voice: VoiceInput }) {
  const t = useChatT('voice');
  const recording = voice.state === 'recording';
  return voice.available ? (
    <button
      type="button" onClick={voice.toggle} disabled={voice.state === 'transcribing'}
      className={`smc-mic is-${voice.state}`} data-testid="chat-mic" data-state={voice.state}
      aria-label={recording ? t('stop') : t('speak')} title={recording ? t('stop') : t('speak')}
    >
      <svg className="smc-mic-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      {recording
        ? <span className="smc-mic-timer" data-testid="chat-mic-timer">{clock(voice.seconds)}</span>
        : <span className="smc-mic-label">{t('label')}</span>}
    </button>
  ) : null;
}

// VoiceLine —— what the mic is doing, or the one sentence on why it didn't work.
function VoiceLine({ voice }: { voice: VoiceInput }) {
  const t = useChatT('voice');
  const line = voice.state === 'transcribing' ? t('transcribing') : voice.problem === '' ? '' : t(voice.problem);
  return line === '' ? null : <p className="smc-voice-line" data-testid="chat-voice-line">{line}</p>;
}

// is-over-ghost —— while a ghost is present, the textarea is absolutely positioned over GhostText
// (which determines the height); otherwise it returns to normal flow and grows its own height.
// Both share one typography rule in chat.css, or text jumps at the instant a ghost is accepted.

// isComposerReady —— whether it can be sent. **pending is not in the
// criteria** (F-A-42): a question sent while the previous turn is in flight
// is queued by `useChat` and lands in the transcript right away, no longer
// silently dropped. `exhausted` still blocks, because that's terminal.
function isComposerReady(msg: string, exhausted: boolean): boolean {
  return msg.trim() !== '' && !exhausted;
}

function ComposerAction({ exhausted }: { exhausted: boolean }) {
  const t = useChatT('composer');
  return exhausted ? (
    <span className="smc-composer-full">{t('sessionFull')}</span>
  ) : (
    // **Not grayed out** while the previous turn is in flight: pressing it
    // queues the question and it lands in the transcript right away, so it
    // stays "Ask" (F-A-42).
    <button type="submit" className="smc-composer-send">
      {t('ask')} <span className="smc-composer-send-key">↵</span>
    </button>
  );
}

function StarterChips({ starters, onPick, pending }: {
  starters: readonly string[]; onPick: (q: string) => void; pending: boolean;
}) {
  const t = useChatT('composer');
  return (
    <div className="smc-starters" data-testid="starter-chips">
      <span className="smc-starters-label">{t('try')}</span>
      {starters.map((q, i) => (
        <StarterChip key={q} q={q} last={i === starters.length - 1} onPick={onPick} pending={pending} />
      ))}
    </div>
  );
}

function StarterChip({ q, last, onPick, pending }: { q: string; last: boolean; onPick: (q: string) => void; pending: boolean }) {
  return (
    <span>
      <button type="button" onClick={() => onPick(q)} disabled={pending} className="smc-starter">
        &ldquo;{q}&rdquo;
      </button>
      {!last && <span className="smc-starter-sep">/</span>}
    </span>
  );
}

// ── dock buttons (#109/#110) ─────────────────────────────────
// ≤2 shortcut buttons the owner configures on a role. Clicking = send the
// owner-written "trigger phrase" as a visitor message (the same path as
// typing). ACL disables the block → grayed out.

function DockButtons({ onPick, pending }: { onPick: (q: string) => void; pending: boolean }) {
  const buttons = useDockButtonsStore((s) => s.buttons);
  const states = useBlockStore((s) => s.states);
  return buttons.length === 0 ? null : (
    <div className="smc-dock-buttons" data-testid="dock-buttons">
      {buttons.map((b) => (
        <DockButton
          key={b.block_id}
          blockId={b.block_id}
          title={b.title}
          trigger={b.trigger}
          state={blockState(states, b.block_id)}
          onPick={onPick}
          pending={pending}
        />
      ))}
    </div>
  );
}

type DockBlockState = { enabled: boolean; reason: string };

function DockButton({
  blockId, title, trigger, state, onPick, pending,
}: {
  blockId: string;
  title: string;
  trigger: string;
  state: DockBlockState;
  onPick: (q: string) => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      disabled={pending || !state.enabled}
      onClick={() => onPick(trigger)}
      data-testid={`dock-button-${blockId}`}
      title={state.enabled ? undefined : state.reason}
      className="smc-dock-button"
    >
      {title}
    </button>
  );
}

// blockState —— read a block's enabled/disabled reason from the
// block store. Not found (this session lacks the block) → disabled.
function blockState(
  states: readonly { id: string; enabled: boolean; policy_summary?: string }[],
  id: string,
): DockBlockState {
  const c = states.find((x) => x.id === id);
  return c
    ? { enabled: c.enabled, reason: c.policy_summary ?? 'unavailable right now' }
    : { enabled: false, reason: 'unavailable right now' };
}
