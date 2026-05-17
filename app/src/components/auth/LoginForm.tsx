// LoginForm —— owner sign-in 表单。业务逻辑全在 useLoginForm hook 里。

'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { Field } from './Field';

import { useLoginForm } from '@/lib/auth/use-login-form';

export function LoginForm() {
  const router = useRouter();
  const form = useLoginForm();

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await form.submit();
    result && router.push(`/${result.owner_handle}`);
  }, [form, router]);

  return (
    <section className="rise max-w-[480px]">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        sign in
      </div>
      <h1 className="reading-tight text-(--color-ink) text-5xl font-normal tracking-tight leading-none">
        Sign in to your<br />corpus<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-4 text-lg leading-relaxed">
        This is your own deployment. Authenticate as the owner.
      </p>

      <form onSubmit={onSubmit} className="mt-10 space-y-5">
        <Field label="email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => form.setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={form.busy}
            data-testid="email"
            autoComplete="email"
            className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
          />
        </Field>
        <Field label="password">
          <input
            type="password"
            value={form.password}
            onChange={(e) => form.setPassword(e.target.value)}
            placeholder="••••••••••••"
            disabled={form.busy}
            data-testid="password"
            autoComplete="current-password"
            className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
          />
        </Field>
        <FormError message={form.error} />
        <div className="flex items-baseline justify-end pt-2">
          <button
            type="submit"
            disabled={form.busy}
            data-testid="submit"
            className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
          >
            {form.busy ? 'authenticating…' : 'sign in ↵'}
          </button>
        </div>
      </form>
    </section>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <div className="mono text-[11px] tracking-[0.06em] text-(--color-accent)" data-testid="error">
      {message}
    </div>
  ) : null;
}
