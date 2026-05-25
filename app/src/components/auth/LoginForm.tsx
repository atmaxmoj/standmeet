// LoginForm —— owner sign-in 表单。业务逻辑全在 useLoginForm hook 里。

'use client';

import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

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
  return (
    <section className="rise max-w-[480px]">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        sign in
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(38px,5vw,56px)] font-normal tracking-[-0.02em] leading-none">
        Sign in to your<br />corpus<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-4 text-lg leading-relaxed">
        This is your own deployment. Authenticate as the owner.
      </p>
      <LoginFormBody form={form} captcha={captcha} onSubmit={onSubmit} />
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
      {captcha.siteKey ? (
        <TurnstileWidget siteKey={captcha.siteKey} onToken={form.setCaptchaToken} />
      ) : null}
      <SubmitRow form={form} captcha={captcha} />
    </form>
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

// enterAdmin —— login 成功后跳进 admin 前必须 reset sessionStore。前一次
// /admin 探测可能把它缓存成 'error'（未授权），不 reset 的话 AdminShell
// 挂载时立刻判定 unauthed → 重新跳 /login，登录死循环。
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
