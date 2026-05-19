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
      className="fixed inset-0 z-50 flex items-start justify-center bg-(--color-ink)/40 fadein overflow-y-auto py-10 px-4"
    >
      <div
        onClick={stop}
        style={{ maxWidth }}
        className="w-full bg-(--color-paper) border border-(--color-rule) rounded-sm rise crosshair my-auto"
      >
        <span className="ch-tl" /><span className="ch-br" />
        <ModalHeader kicker={kicker} title={title} onClose={onClose} />
        {children}
      </div>
    </div>
  );
}

function ModalHeader({
  kicker, title, onClose,
}: { kicker?: string; title: string; onClose: () => void }) {
  return (
    <div className="flex items-baseline justify-between px-7 py-5 border-b border-(--color-rule)">
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
