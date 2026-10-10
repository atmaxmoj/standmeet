// Chip —— mono lowercase small tag, clickable toggle. Used for tags / scopes.

import type { MouseEventHandler, ReactNode } from 'react';

import { resolveChipClass, type ChipTone } from '@/lib/admin/chip-styles';

type Props = {
  children: ReactNode;
  tone?: ChipTone;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  testid?: string;
};

export function Chip(props: Props) {
  const cls = resolveChipClass(props.tone, props.active, Boolean(props.onClick));
  return props.onClick
    ? (
      <ChipButton onClick={props.onClick} title={props.title} cls={cls} testid={props.testid} pressed={props.active}>
        {props.children}
      </ChipButton>
    )
    : <ChipSpan title={props.title} cls={cls}>{props.children}</ChipSpan>;
}

// A clickable chip is a toggle: aria-pressed says which one is on (screen readers, and tests).
function ChipButton({
  onClick, title, cls, testid, pressed, children,
}: {
  onClick: MouseEventHandler<HTMLButtonElement>; title?: string; cls: string; testid?: string;
  pressed?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick} title={title} className={cls} data-testid={testid}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}

function ChipSpan({ title, cls, children }: { title?: string; cls: string; children: ReactNode }) {
  return <span title={title} className={cls}>{children}</span>;
}
