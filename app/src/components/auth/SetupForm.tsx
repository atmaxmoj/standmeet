// SetupForm —— first-run claim wizard。两步：identity / credentials。
// 业务逻辑全在 useSetupForm hook 里；这里只组装 JSX。

'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { Field } from '@/components/auth/Field';
import { TerminalBox } from '@/components/auth/TerminalBox';

import { useSetupForm, type SetupFormHook } from '@/lib/auth/use-setup-form';

type Props = {
  setupToken: string;
};

export function SetupForm({ setupToken }: Props) {
  const router = useRouter();
  const form = useSetupForm(setupToken);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await form.submit();
    // claim 成功 → /admin。owner 部署完第一件事就是进 admin 配置内容，
    // 不必先弹回访客视角的公开页。书签 /admin 之后就稳定了。
    result && router.push('/admin');
  }, [form, router]);

  return (
    <section className="rise max-w-[640px]">
      <SetupHeader step={form.step} />
      <TerminalBox />
      <form onSubmit={onSubmit} className="mt-10 space-y-5 max-w-[520px]">
        <SetupStepBody form={form} />
        <FormError message={form.error} />
        <SetupNav form={form} />
      </form>
    </section>
  );
}

function SetupHeader({ step }: { step: 1 | 2 }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3">
        <span>first-run setup</span>
        <span className="text-(--color-faint)">·</span>
        <span className="text-(--color-faint)">step {step} of 2</span>
      </div>
      <h1
        className="font-serif text-(--color-ink)"
        style={{ fontSize: 'clamp(38px, 5vw, 56px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1 }}
      >
        Claim this<br />instance<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-4 text-lg leading-relaxed">
        Nobody has claimed this deployment yet. The first person to sign up becomes the owner.
      </p>
    </div>
  );
}

function SetupStepBody({ form }: { form: SetupFormHook }) {
  return form.step === 1 ? <SetupStepIdentity form={form} /> : <SetupStepCredentials form={form} />;
}

function SetupStepIdentity({ form }: { form: SetupFormHook }) {
  return (
    <div className="space-y-5 rise">
      <Field label="your full name">
        <input
          type="text"
          value={form.form.full}
          onChange={(e) => form.setField('full', e.target.value)}
          data-testid="full"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <Field label="handle" hint="internal owner identifier · used by admin URLs and login response">
        <input
          type="text"
          value={form.form.handle}
          onChange={(e) => form.setField('handle', e.target.value)}
          data-testid="handle"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <Field
        label="public URL"
        hint="full URL recruiters land on via QR · e.g. https://alice.dev or http://localhost:38127"
      >
        <input
          type="url"
          value={form.form.publicUrl}
          onChange={(e) => form.setField('publicUrl', e.target.value)}
          placeholder="https://alice.dev"
          data-testid="public-url"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
    </div>
  );
}

function SetupStepCredentials({ form }: { form: SetupFormHook }) {
  return (
    <div className="space-y-5 rise">
      <Field label="email" hint="used to sign in and to recover the account">
        <input
          type="email"
          value={form.form.email}
          onChange={(e) => form.setField('email', e.target.value)}
          data-testid="email"
          autoComplete="email"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <div className="grid grid-cols-2 gap-5">
        <Field label="password">
          <input
            type="password"
            value={form.form.password}
            onChange={(e) => form.setField('password', e.target.value)}
            placeholder="8+ characters"
            data-testid="password"
            autoComplete="new-password"
            className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
          />
        </Field>
        <Field label="confirm">
          <input
            type="password"
            value={form.form.passwordConfirm}
            onChange={(e) => form.setField('passwordConfirm', e.target.value)}
            data-testid="password-confirm"
            autoComplete="new-password"
            className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
          />
        </Field>
      </div>
    </div>
  );
}

function SetupNav({ form }: { form: SetupFormHook }) {
  return form.step === 1
    ? <NavStep1 next={form.next} canNext={canAdvance(form.form)} />
    : <NavStep2 back={form.back} busy={form.busy} />;
}

function canAdvance(f: SetupFormHook['form']): boolean {
  return f.full.trim() !== '' && f.handle !== '' && f.publicUrl.trim() !== '';
}

function NavStep1({ next, canNext }: { next: () => void; canNext: boolean }) {
  return (
    <div className="flex items-center justify-end pt-2">
      <button
        type="button"
        onClick={next}
        disabled={!canNext}
        data-testid="next"
        className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
      >
        next →
      </button>
    </div>
  );
}

function NavStep2({ back, busy }: { back: () => void; busy: boolean }) {
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        onClick={back}
        disabled={busy}
        className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-ink)"
      >
        ← back
      </button>
      <button
        type="submit"
        disabled={busy}
        data-testid="submit"
        className="mono text-xs tracking-widest uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 disabled:opacity-40"
      >
        {busy ? 'claiming…' : 'claim instance ↵'}
      </button>
    </div>
  );
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <div className="mono text-[11px] tracking-[0.06em] text-(--color-accent)" data-testid="error">
      {message}
    </div>
  ) : null;
}
