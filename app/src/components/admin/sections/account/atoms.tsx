// atoms —— /admin/account 三块表单共用的小件。
//
// 从 AccountSection.tsx 拆出来，因为 email 那一块自己成了一个文件（改邮箱现在有
// 确认框 + 待确认行 + 撤销），而它跟 full-name / password 两块共用这三件。
// 放在 AccountSection 里让 EmailBlock 去 import 会成环。

'use client';

import type { ReactNode } from 'react';

// AcctBlock —— like the page Block but WITHOUT its section border-t. The account
// fields already separate with their own input underlines, so the extra divider
// (only the 2nd block in a card picked it up — e.g. above "email") read redundant.
export function AcctBlock(
  { title, blurb, children, testid }:
  { title: string; blurb?: string; children: ReactNode; testid?: string },
) {
  return (
    // testid 挂在 section 上,**包住 blurb** —— "这一块说了什么"包括那句说明,
    // 而说明恰恰是唯一说得出"改邮箱会一起搬走恢复渠道"的地方。
    // 挂在内层的话断言看不到它,而看不到跟没写在产品上长得一模一样。
    <section className="mt-10 first:mt-0" data-testid={testid}>
      <div className="mb-7 flex items-baseline gap-4 flex-wrap">
        <h2 className="font-serif text-(--color-ink) text-[22px] font-medium tracking-[-0.012em]">{title}</h2>
        {blurb ? (
          <p className="reading-tight text-(--color-muted) flex-1 min-w-[20em] text-[14px] max-w-[46em]">{blurb}</p>
        ) : null}
      </div>
      <div className="space-y-7">{children}</div>
    </section>
  );
}

interface PasswordFieldProps {
  testid: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}

export function PasswordField({ testid, value, onChange, label }: PasswordFieldProps) {
  return (
    <label className="block mt-3">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        data-testid={testid}
        className="sm-field-input sm-field-lg"
      />
    </label>
  );
}

interface SaveBtnProps {
  testid: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
}

export function SaveBtn({ testid, disabled, label, onClick }: SaveBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {label}
    </button>
  );
}
