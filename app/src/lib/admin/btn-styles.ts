// btn-styles —— Btn 的 size / kind class 拼装。挪到 lib 才不踩 complexity ≤ 3。

import type { BtnKind, BtnSize } from '@/components/admin/atoms/Btn';

const BASE =
  'mono uppercase tracking-[0.14em] transition-colors disabled:opacity-40 ' +
  'inline-flex items-center gap-2';

const SIZE_CLS: Record<BtnSize, string> = {
  sm: 'text-[10.5px] px-2.5 py-1.5',
  md: 'text-[11px] px-3.5 py-2',
  lg: 'text-[12px] px-5 py-2.5',
};

const KIND_CLS: Record<BtnKind, string> = {
  ghost:   'text-(--color-muted) hover:text-(--color-ink)',
  outline: 'border border-(--color-rule) text-(--color-ink) hover:border-(--color-ink)',
  primary: 'bg-(--color-ink) text-(--color-paper) hover:bg-(--color-accent)',
  danger:  'text-(--color-muted) hover:text-(--color-accent)',
};

export function resolveBtnClass(kind: BtnKind = 'ghost', size: BtnSize = 'md'): string {
  return `${BASE} ${SIZE_CLS[size]} ${KIND_CLS[kind]}`;
}
