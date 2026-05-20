// Btn —— admin 通用 button。
// 4 kinds: ghost / outline / primary / danger。3 sizes: sm / md / lg。
//
// 组件 API 不暴露 data-testid —— 那是测试关心的事情，不该污染 production
// 接口。e2e 用 role + accessible name（button 名字就是 children 文本）定位。

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
};

export function Btn(props: Props) {
  const cls = resolveBtnClass(props.kind, props.size);
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      className={cls}
    >
      {props.children}
    </button>
  );
}
