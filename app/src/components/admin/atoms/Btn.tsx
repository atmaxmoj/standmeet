// Btn —— common admin button. Styling comes **entirely** from the `.sm-btn` atom
// (see btn-styles.ts for the rationale). 4 kinds: ghost / outline / solid / danger.
// 3 sizes: sm / md / lg. `kind` uses the same vocabulary as the CSS atom —
// this component used to call it `primary` while the atom called it `solid`,
// and that vocabulary mismatch is exactly what produced `sm-btn-primary`
// (a class name that generates no CSS at all).
//
// The component API does not expose data-testid — that's a test concern and
// shouldn't pollute the production interface. e2e locates via role + accessible
// name (the button's name is its children text).

import type { MouseEventHandler, ReactNode } from 'react';

import { resolveBtnClass } from '@/lib/admin/btn-styles';

export type BtnKind = 'ghost' | 'outline' | 'solid' | 'danger';
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
