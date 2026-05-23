// PasswordResetForm —— /account/reset?t=... 表单。
//
// 流程：服务器上 operator 跑 `standmeet password-reset` 子命令颁发 token，
// 拷链接来浏览器打开。这里从 query 读 token + 输入新密码两次 → POST
// /api/v1/account/reset-password { token, new_password }。
// 成功 → /login。失败统一显示 "invalid or expired"。
// token 缺失 → 提示用 server CLI。

'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { Field } from '@/components/auth/Field';
import { usePasswordResetForm, type PasswordResetFormHook } from '@/lib/auth/use-password-reset-form';

export function PasswordResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('t') ?? '';
  const hook = usePasswordResetForm();

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await hook.submit(token);
    ok && router.push('/login');
  }, [hook, token, router]);

  return token === '' ? <MissingToken /> : <ResetUI hook={hook} onSubmit={onSubmit} />;
}

function MissingToken() {
  return (
    <section className="rise max-w-[480px]">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        password reset
      </div>
      <h1 className="font-serif text-(--color-ink) text-[40px] tracking-[-0.02em] leading-none">
        Missing token<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-4 text-lg leading-relaxed">
        Run <code className="mono text-(--color-ink) bg-(--color-surface) px-1.5 py-0.5">
        make password-reset</code> on the host to get a fresh one-time link.
      </p>
    </section>
  );
}

interface ResetUIProps {
  hook: PasswordResetFormHook;
  onSubmit: (e: React.FormEvent) => Promise<void> | void;
}

function ResetUI({ hook, onSubmit }: ResetUIProps) {
  return (
    <section className="rise max-w-[480px]">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        password reset
      </div>
      <h1 className="font-serif text-(--color-ink)"
        style={{ fontSize: 'clamp(38px, 5vw, 56px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1 }}
      >
        Set a new<br />password<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-4 text-lg leading-relaxed">
        Token good for 30 minutes after the host CLI issued it.
      </p>
      <ResetFormBody hook={hook} onSubmit={onSubmit} />
    </section>
  );
}

function ResetFormBody({ hook, onSubmit }: ResetUIProps) {
  return (
    <form onSubmit={onSubmit} className="mt-10 space-y-5">
      <Field label="new password (≥ 12 chars)">
        <input
          type="password"
          value={hook.next}
          onChange={(e) => hook.setNext(e.target.value)}
          disabled={hook.busy}
          data-testid="reset-new-password"
          autoComplete="new-password"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <Field label="confirm new password">
        <input
          type="password"
          value={hook.confirm}
          onChange={(e) => hook.setConfirm(e.target.value)}
          disabled={hook.busy}
          data-testid="reset-confirm-password"
          autoComplete="new-password"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <ErrorLine message={hook.error} />
      <SubmitRow busy={hook.busy} />
    </form>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <div className="mono text-[11px] tracking-[0.06em] text-(--color-accent)" data-testid="reset-error">
      {message}
    </div>
  ) : null;
}

function SubmitRow({ busy }: { busy: boolean }) {
  return (
    <div className="flex items-baseline justify-end pt-2">
      <button
        type="submit"
        disabled={busy}
        data-testid="reset-submit"
        className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
      >
        {busy ? 'updating…' : 'set new password ↵'}
      </button>
    </div>
  );
}
