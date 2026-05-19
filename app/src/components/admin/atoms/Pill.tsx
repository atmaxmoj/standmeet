// Pill —— mono uppercase 圆角小标签。SystemPulse / banner 用。

import type { ReactNode } from 'react';

const TONE_CLS = {
  neutral: 'text-(--color-muted) border-(--color-rule)',
  accent: 'text-(--color-accent) border-(--color-accent)/40',
  muted:  'text-(--color-faint) border-(--color-rule)',
} as const;

type Props = {
  children: ReactNode;
  tone?: keyof typeof TONE_CLS;
};

export function Pill({ children, tone = 'neutral' }: Props) {
  return (
    <span
      className={
        `inline-flex items-center gap-1.5 px-2.5 py-0.5 border rounded-full ` +
        `mono text-[10px] tracking-[0.12em] uppercase ${TONE_CLS[tone]}`
      }
    >
      {children}
    </span>
  );
}
