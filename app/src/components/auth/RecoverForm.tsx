// RecoverForm — #100 account recovery. When locked out, enter email + recovery
// phrase to sign back in. Success → backend writes a session cookie → land on
// /admin to change the password. All business logic lives in useRecoverForm.

'use client';

import { useTranslations } from 'next-intl';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { Field } from '@/components/auth/Field';
import { sessionStore } from '@/lib/admin/use-admin-session';
import { useRecoverForm, type RecoverFormHook } from '@/lib/auth/use-recover-form';

export function RecoverForm() {
  const router = useRouter();
  const form = useRecoverForm();
  const t = useTranslations('auth.recover');
  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await form.submit();
    ok && enterAdmin(router);
  }, [form, router]);
  return (
    <section className="rise max-w-[480px]">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        {t('eyebrow')}
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(38px,5vw,56px)] font-normal tracking-[-0.02em] leading-none">
        {t('headingA')}<br />{t('headingB')}<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-4 text-lg leading-relaxed">
        {t('lede')}
      </p>
      <RecoverBody form={form} onSubmit={onSubmit} />
      <a
        href="/login"
        className="mono text-[11px] tracking-[0.06em] text-(--color-muted) hover:text-(--color-ink) mt-6 inline-block"
      >
        {t('backLink')}
      </a>
    </section>
  );
}

// enterAdmin — reset sessionStore before routing into admin after success
// (same as LoginForm: guards against a prior unauthed probe caching a state
// that bounces AdminShell back to /login in a loop).
function enterAdmin(router: AppRouterInstance): void {
  sessionStore.getState().reset();
  router.push('/admin');
}

interface BodyProps {
  form: RecoverFormHook;
  onSubmit: (e: React.FormEvent) => Promise<void> | void;
}

function RecoverBody({ form, onSubmit }: BodyProps) {
  const input =
    'w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base';
  return (
    <form onSubmit={onSubmit} className="mt-10 space-y-5">
      <Field label="email">
        <input
          type="email" value={form.email} onChange={(e) => form.setEmail(e.target.value)}
          placeholder="you@example.com" disabled={form.busy} data-testid="email"
          autoComplete="email" className={input}
        />
      </Field>
      <Field label="recovery phrase">
        <input
          type="text" value={form.phrase} onChange={(e) => form.setPhrase(e.target.value)}
          placeholder="k7m2-9xqp-…" disabled={form.busy} data-testid="recovery-phrase"
          autoComplete="off" className={`${input} mono`}
        />
      </Field>
      <RecoverError message={form.error} />
      <div className="flex items-baseline justify-end pt-2">
        <button
          type="submit" disabled={form.busy} data-testid="submit"
          className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
        >
          {form.busy ? 'recovering…' : 'recover ↵'}
        </button>
      </div>
    </form>
  );
}

function RecoverError({ message }: { message: string | null }) {
  return message ? (
    <div className="mono text-[11px] tracking-[0.06em] text-(--color-accent)" data-testid="error">
      {message}
    </div>
  ) : null;
}
