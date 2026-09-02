// MetaPair —— horizontal key-value pair: mono uppercase label + serif content.

import type { ReactNode } from 'react';

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function MetaPair({ label, children, className = '' }: Props) {
  return (
    <div className={className}>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5">
        {label}
      </div>
      <div className="font-serif text-(--color-ink) text-[15px] leading-snug">{children}</div>
    </div>
  );
}
