// Chip —— mono lowercase 小标签，可点击切换。tags / scopes 用。

import type { MouseEventHandler, ReactNode } from 'react';

import { resolveChipClass, type ChipTone } from '@/lib/admin/chip-styles';

type Props = {
  children: ReactNode;
  tone?: ChipTone;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
};

export function Chip(props: Props) {
  const cls = resolveChipClass(props.tone, props.active, Boolean(props.onClick));
  return props.onClick
    ? <ChipButton onClick={props.onClick} title={props.title} cls={cls}>{props.children}</ChipButton>
    : <ChipSpan title={props.title} cls={cls}>{props.children}</ChipSpan>;
}

function ChipButton({
  onClick, title, cls, children,
}: { onClick: MouseEventHandler<HTMLButtonElement>; title?: string; cls: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title} className={cls}>
      {children}
    </button>
  );
}

function ChipSpan({ title, cls, children }: { title?: string; cls: string; children: ReactNode }) {
  return <span title={title} className={cls}>{children}</span>;
}
