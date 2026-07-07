// AskInput —— Hero 里的"Ask anything." 输入条。`›` 大号 accent caret +
// 上下两道 1.5px ink 边线 + 右侧 "ask ↵" mono 提示。访客最先互动的元件。
//
// 受控：value/onChange 由 parent 管；提交走 onSubmit(value)。disabled 时
// 输入框 + button 都 dim 掉，避免重复发送 + 让视觉知道"在思考中"。
//
// H.13.d: ghost 是当前应渲的灰色 ghost text (code-accessor visitor 进
// 来时 backend 给的 ghosts[0]，每轮 AI 答完 follow-up 帧
// 追加；其他 mode 永远 null)。input 空 + 非 disabled / locked 时渲；按
// **Tab** → onAcceptGhost(ghost) 填进 input 不自动 submit；**Esc** →
// onCycleGhost() 走下一条。开始打字 → ghost 被 value 自然遮住。

'use client';

import type { FormEvent, RefObject } from 'react';

import { dispatchGhostKey, pickGhost, pickPlaceholder } from '@/lib/visitor/ghost-text';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q: string) => void;
  disabled: boolean;
  // lockedReason —— quota 用尽 / 其它 long-term lock。设置后输入框 dim +
  // 右侧 "ask ↵" 换成 lockedReason 文案 + chat input 整体不可投。
  // 不设 = null → 走 transient `disabled` (pending 中) 逻辑。
  lockedReason?: string | null;
  inputRef?: RefObject<HTMLInputElement | null>;
  // H.13.d ghost text 三件套；不传 → 整套 ghost 关闭。
  ghost?: string | null;
  onAcceptGhost?: (ghost: string) => void;
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
      data-testid="chat-input-field"
      data-ghost={ghost ?? ''}
    />
  );
}

function isLocked(props: Props): boolean {
  return (props.lockedReason ?? null) !== null;
}

function AskAction({ props, locked }: { props: Props; locked: boolean }) {
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
      ask <span className="text-[14px]">↵</span>
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
