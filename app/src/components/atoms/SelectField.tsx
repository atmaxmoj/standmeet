// SelectField — the app's only dropdown.
//
// Why a component instead of a class name (UX-47):
// Before this, 19 `<select>`s had **five** mutually-unaware styles — boxed border,
// small box, underline, sm-field-input, and gate's near-black solid one. Adding a
// `.sm-select` class doesn't fix it: a class name depends on people remembering to
// apply it, and **the next person writing a dropdown won't know it exists** — that's
// exactly how the previous five styles came to be.
// The component turns "apply it or not" from a choice into the default, then a gate
// (check-one-select.sh) bans bare `<select>`.
//
// The other reason it has to be a component is **technical**: the vermillion arrow
// has to hang off a pseudo-element, and `<select>` can't host `::after`. A shell
// layer is required. Since we must wrap an extra layer anyway, the component should
// own it instead of requiring every call site to remember to wrap.
//
// className lands on the **shell**, because the shell is the layout box (w-full /
// shrink-0 / min-w-0 all belong to it); the dropdown's own look is decided by the
// component, and call sites only get a say via the single `mono` switch — five
// styles collapsed into two, and that collapse IS the fix.

'use client';

import type { ReactNode, SelectHTMLAttributes } from 'react';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  /** Classes that land on the shell (layout box): width, flex behavior. */
  className?: string;
  /**
   * Monospace. Use for machine-read values (table rows, capability ids);
   * human-written titles use the default serif.
   */
  mono?: boolean;
  /**
   * Takes `testid` instead of letting call sites write `data-testid` directly — lint
   * bans data-testid on components, because **it might land nowhere**. Here the
   * component guarantees it lands on the real `<select>`, so the rule's intent holds,
   * while the rule still applies normally to other components (see
   * [[move-the-capability-move-its-edges]]: when a capability moves house, its edges —
   * test hooks, lint exemptions — don't automatically follow).
   */
  testid?: string;
  children: ReactNode;
};

function selectClass(mono: boolean): string {
  return mono ? 'sm-field-input sm-select sm-mono' : 'sm-field-input sm-select';
}

export function SelectField({ className = '', mono = false, testid, children, ...rest }: Props) {
  return (
    <span className={`sm-select-shell ${className}`}>
      <select className={selectClass(mono)} data-testid={testid} {...rest}>
        {children}
      </select>
    </span>
  );
}
