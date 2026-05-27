// FloatingChatDock —— visitor 可以从 blog/wiki/output 任意 surface 不离页
// 直接 chat。collapsed = 右下角 pill 按钮；expanded = 浮动面板（input +
// transcript），同步同一 visitor-session（zustand store + 持久 conversation_id）。
//
// 跟 PageShell 上的 inline Hero/AskInput 共用 useConversation hook —— 同
// session_token 同 conversation_id；server 看是同一个会话。owner 在
// /admin/conversations 看 transcript 也是同一行。
//
// 设计意图（memory: visitor-chat-everywhere）：持 code 的 visitor 在
// blog/wiki/output 看完文章想"继续问"不必跳回 `/`。AskAboutThis starter
// prompt 走 `?q=` 跳 `/` 那条路保留；FloatingChatDock 走 inline。
//
// SSR-safe：组件 'use client'，所有 zustand / fetch / WebStorage 都在
// mount 之后跑。public tier 也可用（visitor 没 code 也能问公共切片）。

'use client';

import { useCallback, useRef, useState } from 'react';

import { useConversation } from '@/lib/page/use-conversation';
import type { SessionTier } from '@/lib/page/use-conversation';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

export function FloatingChatDock() {
  const [open, setOpen] = useState(false);
  const tier = useTierFromVisitorStore();
  const conv = useConversation({ tier });
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onAsk = useCallback((q: string) => {
    setInput('');
    void conv.ask(q);
  }, [conv]);

  return (
    <>
      <ChatTrigger
        open={open}
        onToggle={() => setOpen((o) => !o)}
        pending={conv.pending}
      />
      {open && (
        <ChatPanel
          input={input}
          setInput={setInput}
          onAsk={onAsk}
          turns={conv.turns}
          pending={conv.pending}
          onReset={conv.reset}
          inputRef={inputRef}
        />
      )}
    </>
  );
}

// useTierFromVisitorStore —— visitor-session store 派生 tier。fresh visitor
// 没 session → 'public'（自带 owner-configured AI provider）。
function useTierFromVisitorStore(): SessionTier {
  return deriveTierFromSession(useVisitorSessionStore((s) => s.session));
}

function deriveTierFromSession(
  session: ReturnType<typeof useVisitorSessionStore.getState>['session'],
): SessionTier {
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
  return open
    ? <span>close ✕</span>
    : pending
      ? <span className="sm-floating-chat-pending">thinking<span className="sm-dot">·</span><span className="sm-dot">·</span><span className="sm-dot">·</span></span>
      : <span>ask <span className="text-[14px]">›</span></span>;
}

interface PanelProps {
  input: string;
  setInput: (v: string) => void;
  onAsk: (q: string) => void;
  turns: ReturnType<typeof useConversation>['turns'];
  pending: boolean;
  onReset: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function ChatPanel(props: PanelProps) {
  return (
    <div
      className="sm-floating-chat-panel sm-rise"
      data-testid="floating-chat-panel"
    >
      <ChatPanelHeader onReset={props.onReset} hasTurns={props.turns.length > 0} />
      <ChatTranscript turns={props.turns} pending={props.pending} />
      <ChatPanelInput
        value={props.input}
        onChange={props.setInput}
        onSubmit={props.onAsk}
        pending={props.pending}
        inputRef={props.inputRef}
      />
    </div>
  );
}

function ChatPanelHeader({ onReset, hasTurns }: { onReset: () => void; hasTurns: boolean }) {
  return (
    <header className="sm-floating-chat-head">
      <span className="sm-smallcaps">ask the AI</span>
      <ResetBtn onReset={onReset} visible={hasTurns} />
    </header>
  );
}

function ResetBtn({ onReset, visible }: { onReset: () => void; visible: boolean }) {
  return visible ? (
    <button
      type="button" onClick={onReset}
      className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) bg-transparent"
    >
      reset
    </button>
  ) : null;
}

function ChatTranscript({
  turns, pending,
}: {
  turns: PanelProps['turns'];
  pending: boolean;
}) {
  return turns.length === 0 && !pending ? <EmptyHint /> : (
    <ol className="sm-floating-chat-transcript">
      {turns.map((t) => <TurnRow key={t.id} turn={t} />)}
    </ol>
  );
}

function EmptyHint() {
  return (
    <p className="sm-floating-chat-empty">
      Ask a follow-up — answered in the owner&rsquo;s voice, grounded in the
      corpus. Same session as the main chat.
    </p>
  );
}

function TurnRow({ turn }: { turn: PanelProps['turns'][number] }) {
  return (
    <li className="sm-floating-chat-turn">
      <div className="sm-smallcaps">you · {turn.time}</div>
      <p className="sm-floating-chat-q">{turn.q}</p>
      <TurnAnswer turn={turn} />
    </li>
  );
}

function TurnAnswer({ turn }: { turn: PanelProps['turns'][number] }) {
  return isThinking(turn) ? <ThinkingDots /> : <AnswerBody answer={turn.answer} />;
}

function isThinking(turn: PanelProps['turns'][number]): boolean {
  return turn.answer === null && turn.pending;
}

function ThinkingDots() {
  return (
    <p className="sm-floating-chat-pending mono text-[11px] tracking-[0.16em] uppercase text-(--color-accent)">
      thinking
      <span className="sm-dot">·</span>
      <span className="sm-dot">·</span>
      <span className="sm-dot">·</span>
    </p>
  );
}

function AnswerBody({ answer }: { answer: PanelProps['turns'][number]['answer'] }) {
  const text = answer === null ? '—' : answer.paras.join('\n\n');
  return (
    <p className="sm-reading text-(--color-ink) text-[15px] whitespace-pre-wrap">
      {text}
    </p>
  );
}

function ChatPanelInput(props: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q: string) => void;
  pending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <form
      onSubmit={(e) => onSubmit(e, props)}
      className="sm-floating-chat-form"
    >
      <span className="sm-floating-chat-prompt">›</span>
      <input
        ref={props.inputRef}
        type="text"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Ask a follow-up…"
        disabled={props.pending}
        data-testid="floating-chat-input"
        className="sm-floating-chat-input"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="submit"
        disabled={props.pending || props.value.trim() === ''}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) bg-transparent"
      >
        ↵
      </button>
    </form>
  );
}

function onSubmit(
  e: React.FormEvent<HTMLFormElement>,
  props: { value: string; onSubmit: (q: string) => void; pending: boolean },
): void {
  e.preventDefault();
  const q = props.value.trim();
  q !== '' && !props.pending && props.onSubmit(q);
}
