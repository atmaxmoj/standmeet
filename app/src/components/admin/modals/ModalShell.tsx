// ModalShell —— overlay + close 行为通用部分。

'use client';

import { useCallback } from 'react';
import type { ReactNode } from 'react';

type Props = {
  onClose: () => void;
  kicker?: string;
  title: string;
  maxWidth?: number;
  children: ReactNode;
};

export function ModalShell({ onClose, kicker, title, maxWidth = 540, children }: Props) {
  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-(--color-ink)/40 fadein p-4"
    >
      <div
        onClick={stop}
        className={`flex flex-col w-full max-h-[85vh] overflow-hidden bg-(--color-paper) border border-(--color-rule) rounded-sm rise crosshair sm-max-w [--max-w:${maxWidth}px]`}
      >
        <span className="ch-tl" /><span className="ch-br" />
        <ModalHeader kicker={kicker} title={title} onClose={onClose} />
        {/* 框固定,只这块滚 —— header/close 永远钉在顶上 */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalHeader({
  kicker, title, onClose,
}: { kicker?: string; title: string; onClose: () => void }) {
  return (
    <div className="shrink-0 flex items-baseline justify-between px-7 py-5 border-b border-(--color-rule)">
      <ModalTitle kicker={kicker} title={title} />
      <button
        type="button"
        onClick={onClose}
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
      >
        close ✕
      </button>
    </div>
  );
}

function ModalTitle({ kicker, title }: { kicker?: string; title: string }) {
  return (
    <div>
      {kicker ? <Kicker text={kicker} /> : null}
      <div className="font-serif text-(--color-ink) text-[22px]">{title}</div>
    </div>
  );
}

function Kicker({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1">
      {text}
    </div>
  );
}
