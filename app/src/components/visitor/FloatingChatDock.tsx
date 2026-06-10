// FloatingChatDock —— visitor 可以从 blog/wiki/output 任意 surface 不离页
// 直接 chat。collapsed = 右下角 pill 按钮；expanded = 浮动面板（input +
// transcript），同步同一 visitor-session（zustand store + 持久 conversation_id）。
//
// 跟 PageShell 上的 inline Hero/AskInput 共用 useChat hook —— 同
// session_token 同 conversation_id；server 看是同一个会话。owner 在
// /admin/conversations 看 transcript 也是同一行。
//
// 设计意图（memory: visitor-chat-everywhere）：持 code 的 visitor 在
// blog/wiki/output 看完文章想"继续问"不必跳回 `/`。AskAboutThis starter
// prompt 走 `?q=` 跳 `/` 那条路保留；FloatingChatDock 走 inline。
//
// SSR-safe：组件 'use client'，所有 zustand / fetch / WebStorage 都在
// mount 之后跑。**public 模式不渲 pill**：没人付 inference 钱（owner 不愿
// 替路过访客买单，visitor 不带 key）。byoai / code mode 才显示。

'use client';

import { useCallback, useRef, useState } from 'react';

import { useChat } from '@/lib/page/use-chat';
import type { SessionMode } from '@/lib/page/use-chat';
import { useGhostLogger } from '@/lib/page/use-ghost-logger';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';
import { useCurrentGhost, useGhostsStore } from '@/lib/visitor/ghosts-store';
import { dispatchGhostKey, pickGhost } from '@/lib/visitor/ghost-text';

export function FloatingChatDock() {
  const mode = useModeFromVisitorStore();
  return mode === 'public' ? null : <FloatingChatDockInner mode={mode} />;
}

function FloatingChatDockInner({ mode }: { mode: SessionMode }) {
  const [open, setOpen] = useState(false);
  const chat = useChat({ mode });
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ghost = useCurrentGhost();
  const cycleGhost = useGhostsStore((s) => s.cycle);
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
          pending={chat.pending}
          onReset={chat.reset}
          inputRef={inputRef}
          ghost={ghost}
          onAcceptGhost={onAcceptGhost}
          onCycleGhost={cycleGhost}
        />
      )}
    </>
  );
}

// useModeFromVisitorStore —— visitor-session store 派生 mode。
// fresh visitor 没 session → 'public'（不渲 pill）。
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
  dialogs: ReturnType<typeof useChat>['dialogs'];
  pending: boolean;
  onReset: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  // H.13.d ghost text 三件套；non-code mode 永远 null。
  ghost: string | null;
  onAcceptGhost: (g: string) => void;
  onCycleGhost: () => void;
}

function ChatPanel(props: PanelProps) {
  return (
    <div
      className="sm-floating-chat-panel sm-rise"
      data-testid="floating-chat-panel"
    >
      <ChatPanelHeader onReset={props.onReset} hasDialogs={props.dialogs.length > 0} />
      <ChatTranscript dialogs={props.dialogs} pending={props.pending} />
      <ChatPanelInput
        value={props.input}
        onChange={props.setInput}
        onSubmit={props.onAsk}
        pending={props.pending}
        inputRef={props.inputRef}
        ghost={props.ghost}
        onAcceptGhost={props.onAcceptGhost}
        onCycleGhost={props.onCycleGhost}
      />
    </div>
  );
}

function ChatPanelHeader({ onReset, hasDialogs }: { onReset: () => void; hasDialogs: boolean }) {
  return (
    <header className="sm-floating-chat-head">
      <span className="sm-smallcaps">ask the AI</span>
      <ResetBtn onReset={onReset} visible={hasDialogs} />
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
  dialogs, pending,
}: {
  dialogs: PanelProps['dialogs'];
  pending: boolean;
}) {
  return dialogs.length === 0 && !pending ? <EmptyHint /> : (
    <ol className="sm-floating-chat-transcript">
      {dialogs.map((d) => <DialogRow key={d.id} dialog={d} />)}
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

function DialogRow({ dialog }: { dialog: PanelProps['dialogs'][number] }) {
  return (
    <li className="sm-floating-chat-dialog">
      <div className="sm-smallcaps">you · {dialog.time}</div>
      <p className="sm-floating-chat-q">{dialog.q}</p>
      <DialogAnswerView dialog={dialog} />
    </li>
  );
}

function DialogAnswerView({ dialog }: { dialog: PanelProps['dialogs'][number] }) {
  return isThinking(dialog) ? <ThinkingDots /> : <AnswerBody answer={dialog.answer} />;
}

function isThinking(dialog: PanelProps['dialogs'][number]): boolean {
  return dialog.answer === null && dialog.pending;
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

function AnswerBody({ answer }: { answer: PanelProps['dialogs'][number]['answer'] }) {
  const text = answer === null ? '—' : answer.paras.join('\n\n');
  return (
    <p className="sm-reading text-(--color-ink) text-[15px] whitespace-pre-wrap">
      {text}
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
  onCycleGhost: () => void;
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
      <ChatPanelInputSubmit pending={props.pending} value={props.value} />
    </form>
  );
}

function ChatPanelInputField({ props, ghost, placeholder }: {
  props: ChatPanelInputProps; ghost: string | null; placeholder: string;
}) {
  return (
    <input
      ref={props.inputRef}
      type="text"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => dispatchGhostKey(e, ghost, { onAccept: props.onAcceptGhost, onCycle: props.onCycleGhost })}
      placeholder={placeholder}
      disabled={props.pending}
      data-testid="floating-chat-input"
      className="sm-floating-chat-input"
      autoComplete="off"
      spellCheck={false}
      data-ghost={ghost ?? ''}
    />
  );
}

function ChatPanelInputSubmit({ pending, value }: { pending: boolean; value: string }) {
  return (
    <button
      type="submit"
      disabled={pending || value.trim() === ''}
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) bg-transparent"
    >
      ↵
    </button>
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
