// Pill —— mono uppercase rounded small tag. Used by SystemPulse / banner.

import type { ReactNode } from 'react';

const TONE_CLS = {
  neutral: 'text-(--color-muted) border-(--color-rule)',
  accent: 'text-(--color-accent) border-(--color-accent)/40',
  muted:  'text-(--color-faint) border-(--color-rule)',
} as const;

type Props = {
  children: ReactNode;
  tone?: keyof typeof TONE_CLS;
  testId?: string;
};

export function Pill({ children, tone = 'neutral', testId }: Props) {
  return (
    <span
      data-testid={testId}
      className={
        `inline-flex items-center gap-1.5 px-2.5 py-0.5 border rounded-full ` +
        `mono text-[10px] tracking-[0.12em] uppercase ${TONE_CLS[tone]}`
      }
    >
      {children}
    </span>
  );
}
