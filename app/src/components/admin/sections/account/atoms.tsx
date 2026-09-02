// atoms — small pieces shared by the three forms on /admin/account.
//
// Split out of AccountSection.tsx because the email block grew into its own file
// (changing email now has a confirm field + pending row + cancel), and it shares
// these three pieces with the full-name and password blocks. Leaving them in
// AccountSection and having EmailBlock import from there would create a cycle.

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
    // testid is on the section, **wrapping the blurb** — "what this block says"
    // includes that copy, and the copy is the only place that states "changing
    // email moves the recovery channel too." Put it on an inner element instead
    // and assertions can't see it, and unseen looks identical to unwritten.
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
