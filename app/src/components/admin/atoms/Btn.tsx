// Btn —— admin 通用 button。
// 4 kinds: ghost / outline / primary / danger。3 sizes: sm / md / lg。

import type { MouseEventHandler, ReactNode } from 'react';

import { resolveBtnClass } from '@/lib/admin/btn-styles';

export type BtnKind = 'ghost' | 'outline' | 'primary' | 'danger';
export type BtnSize = 'sm' | 'md' | 'lg';

type Props = {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  kind?: BtnKind;
  size?: BtnSize;
  disabled?: boolean;
  type?: 'button' | 'submit';
  testid?: string;
};

export function Btn(props: Props) {
  const cls = resolveBtnClass(props.kind, props.size);
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.testid}
      className={cls}
    >
      {props.children}
    </button>
  );
}
