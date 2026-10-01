// SecretInput —— the one masked field in this product: a password / token / key input with an eye
// that shows what was typed.
//
// Owner, 2026-09-30, looking at a token field of five dots: "这种密码的你都应该排查一下，都需要那种
// 小眼睛 … 做成一个统一组件，然后各个地方用，然后把裸密码/令牌输入框lint禁了". A pasted token one
// character short looks exactly like the right one until the connect fails. Only the login form had
// an eye. `type="password"` is now written here and nowhere else (eslint enforces it).
//
// The eye's testid is the field's plus `-reveal`; it sits right after the field.

'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

export interface SecretInputProps {
  testid: string;
  onChange: (v: string) => void;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  autoComplete?: string;
  name?: string;
  disabled?: boolean;
  // className —— the field's look (`sm-field-input` + modifiers); the eye adapts to it.
  className: string;
}

export function SecretInput(p: SecretInputProps) {
  const [shown, setShown] = useState(false);
  return (
    <span className="sm-secret">
      <input
        type={shown ? 'text' : 'password'}
        data-testid={p.testid}
        value={p.value}
        defaultValue={p.defaultValue}
        onChange={(e) => p.onChange(e.target.value)}
        placeholder={p.placeholder}
        autoComplete={p.autoComplete ?? 'new-password'}
        name={p.name}
        disabled={p.disabled}
        spellCheck={false}
        className={p.className}
      />
      <Eye testid={`${p.testid}-reveal`} shown={shown} onToggle={() => setShown((s) => !s)} />
    </span>
  );
}

function Eye({ testid, shown, onToggle }: { testid: string; shown: boolean; onToggle: () => void }) {
  const t = useTranslations('auth.secretInput');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? t('hide') : t('show')}
      aria-pressed={shown}
      data-testid={testid}
      className="sm-secret-eye"
    >
      <EyeIcon off={shown} />
    </button>
  );
}

// EyeIcon —— open eye (hidden, click to show) vs struck-through eye (shown).
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <line x1="3" y1="3" x2="21" y2="21" /> : null}
    </svg>
  );
}
