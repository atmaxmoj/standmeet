// AskInput —— Hero 里的"Ask anything." 输入条。`›` 大号 accent caret +
// 上下两道 1.5px ink 边线 + 右侧 "ask ↵" mono 提示。访客最先互动的元件。
//
// 受控：value/onChange 由 parent 管；提交走 onSubmit(value)。disabled 时
// 输入框 + button 都 dim 掉，避免重复发送 + 让视觉知道"在思考中"。

'use client';

import type { FormEvent, RefObject } from 'react';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (q: string) => void;
  disabled: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function AskInput({ value, onChange, onSubmit, disabled, inputRef }: Props) {
  const handle = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const q = value.trim();
    const ready = q !== '' && !disabled;
    ready && onSubmit(q);
  };
  return (
    <form onSubmit={handle} data-testid="chat-input">
      <div className="flex items-baseline gap-4 py-4 border-t-[1.5px] border-b-[1.5px] border-(--color-ink) relative">
        <span className="text-(--color-accent) font-serif shrink-0 text-[28px] leading-none">›</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ask anything."
          disabled={disabled}
          className="flex-1 bg-transparent text-(--color-ink) placeholder:text-(--color-faint) font-serif min-w-0 text-[clamp(20px,2.2vw,26px)] leading-[1.3] font-[380]"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={disabled || value.trim() === ''}
          className="mono text-[11.5px] tracking-[0.18em] uppercase text-(--color-muted) hover:text-(--color-accent) disabled:text-(--color-faint) transition-colors shrink-0 pt-1"
        >
          ask <span className="text-[14px]">↵</span>
        </button>
      </div>
    </form>
  );
}
