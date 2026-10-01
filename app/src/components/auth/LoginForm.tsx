// LoginForm — owner sign-in form. All business logic lives in the useLoginForm hook.

'use client';

import { useTranslations } from 'next-intl';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { SecretInput } from '@/components/atoms/SecretInput';
import { Field } from '@/components/auth/Field';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';

import { sessionStore } from '@/lib/admin/use-admin-session';
import { useCaptchaSiteKey } from '@/lib/auth/use-captcha-site-key';
import { useLoginForm } from '@/lib/auth/use-login-form';

export function LoginForm() {
  const router = useRouter();
  const form = useLoginForm();
  const captcha = useCaptchaSiteKey();
  const onSubmit = useSubmitHandler(form, router);
  return <LoginShell form={form} captcha={captcha} onSubmit={onSubmit} />;
}

function useSubmitHandler(
  form: ReturnType<typeof useLoginForm>, router: AppRouterInstance,
): (e: React.FormEvent) => Promise<void> {
  return useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await form.submit();
    result && enterAdmin(router);
  }, [form, router]);
}

interface ShellProps {
  form: ReturnType<typeof useLoginForm>;
  captcha: ReturnType<typeof useCaptchaSiteKey>;
  onSubmit: (e: React.FormEvent) => Promise<void> | void;
}

function LoginShell({ form, captcha, onSubmit }: ShellProps) {
  const t = useTranslations('auth.login');
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
      <LoginFormBody form={form} captcha={captcha} onSubmit={onSubmit} />
      <a
        href="/recover"
        data-testid="recover-link"
        className="mono text-[11px] tracking-[0.06em] text-(--color-muted) hover:text-(--color-ink) mt-6 inline-block"
      >
        {t('recoverLink')}
      </a>
    </section>
  );
}

function LoginFormBody({ form, captcha, onSubmit }: ShellProps) {
  return (
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
          className="sm-field-input"
        />
      </Field>
      <PasswordField form={form} />
      <FormError message={form.error} />
      {captcha.siteKey ? (
        <TurnstileWidget siteKey={captcha.siteKey} onToken={form.setCaptchaToken} />
      ) : null}
      <SubmitRow form={form} captcha={captcha} />
    </form>
  );
}

function PasswordField({ form }: { form: ReturnType<typeof useLoginForm> }) {
  return (
    <Field label="password">
      <SecretInput
        testid="password"
        value={form.password}
        onChange={form.setPassword}
        placeholder="••••••••••••"
        disabled={form.busy}
        autoComplete="current-password"
        className="sm-field-input"
      />
    </Field>
  );
}

function SubmitRow({
  form, captcha,
}: { form: ReturnType<typeof useLoginForm>; captcha: ReturnType<typeof useCaptchaSiteKey> }) {
  const disabled = submitDisabled(form.busy, captcha.siteKey, form.captchaToken);
  return (
    <div className="flex items-baseline justify-end pt-2">
      <button
        type="submit"
        disabled={disabled}
        data-testid="submit"
        className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
      >
        {form.busy ? 'authenticating…' : 'sign in ↵'}
      </button>
    </div>
  );
}

function submitDisabled(busy: boolean, siteKey: string, captchaToken: string): boolean {
  return busy || (siteKey !== '' && captchaToken === '');
}

// enterAdmin — must reset sessionStore before routing into admin after a
// successful login. A prior /admin probe may have cached it as 'error'
// (unauthorized); without the reset, AdminShell mounts and immediately
// judges unauthed → bounces back to /login, an infinite login loop.
function enterAdmin(router: AppRouterInstance): void {
  sessionStore.getState().reset();
  router.push('/admin');
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <div className="mono text-[11px] tracking-[0.06em] text-(--color-accent)" data-testid="error">
      {message}
    </div>
  ) : null;
}
