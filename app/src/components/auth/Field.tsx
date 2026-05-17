// Field —— smallcaps label + 可选 hint + 包裹的输入。auth 表单共用。

import type { ReactNode } from 'react';

type Props = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function Field({ label, hint, children }: Props) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5 flex items-baseline gap-2">
        <span>{label}</span>
        <FieldHint text={hint} />
      </div>
      {children}
    </div>
  );
}

function FieldHint({ text }: { text?: string }) {
  return text ? (
    <span className="text-(--color-faint) normal-case tracking-[0.04em]">· {text}</span>
  ) : null;
}
