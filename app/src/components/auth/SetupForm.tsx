// SetupForm —— first-run claim wizard。4 步：identity / credentials /
// ai-provider / verify。业务逻辑全在 useSetupForm hook 里；这里只组装 JSX。
//
// 设计源 docs/design/project/auth.js Setup (153-460)。

'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { Field } from '@/components/auth/Field';
import { TerminalBox } from '@/components/auth/TerminalBox';

import {
  handleSetupSubmit,
  SETUP_PROVIDERS,
  useSetupForm,
  type SetupFormHook,
} from '@/lib/auth/use-setup-form';

type Props = {
  setupToken: string;
};

const STEP_LABELS = ['identity', 'credentials', 'ai provider', 'verify'] as const;

export function SetupForm({ setupToken }: Props) {
  const router = useRouter();
  const form = useSetupForm(setupToken);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSetupSubmit(form, router.push.bind(router));
  }, [form, router]);

  return (
    <section className="rise max-w-[640px]">
      <SetupHeader step={form.step} />
      <StepProgress step={form.step} />
      <TerminalBox />
      <form onSubmit={onSubmit} className="mt-10 space-y-5 max-w-[520px]">
        <StepBody form={form} />
        <FormError message={form.error} />
        <SetupNav form={form} />
      </form>
    </section>
  );
}

function SetupHeader({ step }: { step: 1 | 2 | 3 | 4 }) {
  const t = useTranslations('auth.setup');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3 flex items-baseline gap-3">
        <span>{t('eyebrow')}</span>
        <span className="text-(--color-faint)">·</span>
        <span className="text-(--color-faint)">{t('stepOf', { step })}</span>
      </div>
      <h1 className="font-serif text-(--color-ink) text-[clamp(38px,5vw,56px)] font-normal tracking-[-0.02em] leading-none">
        {t('headingA')}<br />{t('headingB')}<span className="text-(--color-accent)">.</span>
      </h1>
      <p className="reading italic text-(--color-muted) mt-4 text-lg leading-relaxed">
        {t('lede')}
      </p>
    </div>
  );
}

function StepProgress({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div className="mt-6 max-w-[520px]">
      <div className="flex gap-1.5">
        {STEP_LABELS.map((_, i) => (
          <StepBar key={i} active={i + 1 <= step} />
        ))}
      </div>
      <div className="mt-2 mono text-[10px] tracking-[0.12em] text-(--color-faint) flex justify-between">
        {STEP_LABELS.map((l, i) => (
          <span
            key={l}
            className={i + 1 === step ? 'text-(--color-ink)' : ''}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function StepBar({ active }: { active: boolean }) {
  return (
    <div
      className={`h-[2px] flex-1 transition-colors ${
        active ? 'bg-(--color-accent)' : 'bg-(--color-rule)'
      }`}
    />
  );
}

function StepBody({ form }: { form: SetupFormHook }) {
  const Body = STEP_BODIES[form.step - 1];
  return Body ? <Body form={form} /> : null;
}

const STEP_BODIES = [StepIdentity, StepCredentials, StepProvider, StepVerify] as const;

function StepIdentity({ form }: { form: SetupFormHook }) {
  return (
    <div className="space-y-5 rise">
      <Field label="your full name">
        <input
          type="text" value={form.form.full}
          onChange={(e) => form.setField('full', e.target.value)}
          data-testid="full"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <Field label="handle" hint="internal owner identifier · used by admin URLs and login response">
        <input
          type="text" value={form.form.handle}
          onChange={(e) => form.setField('handle', e.target.value)}
          data-testid="handle"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <Field label="public URL" hint="full URL recruiters land on via QR · e.g. https://alice.dev or http://localhost:38127">
        <input
          type="url" value={form.form.publicUrl}
          onChange={(e) => form.setField('publicUrl', e.target.value)}
          placeholder="https://alice.dev"
          data-testid="public-url"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
    </div>
  );
}

function StepCredentials({ form }: { form: SetupFormHook }) {
  return (
    <div className="space-y-5 rise">
      <Field label="email" hint="used to sign in and to recover the account">
        <input
          type="email" value={form.form.email}
          onChange={(e) => form.setField('email', e.target.value)}
          data-testid="email" autoComplete="email"
          className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
        />
      </Field>
      <div className="grid grid-cols-2 gap-5">
        <Field label="password">
          <input
            type="password" value={form.form.password}
            onChange={(e) => form.setField('password', e.target.value)}
            placeholder="8+ characters"
            data-testid="password" autoComplete="new-password"
            className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
          />
        </Field>
        <Field label="confirm">
          <input
            type="password" value={form.form.passwordConfirm}
            onChange={(e) => form.setField('passwordConfirm', e.target.value)}
            data-testid="password-confirm" autoComplete="new-password"
            className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-base"
          />
        </Field>
      </div>
    </div>
  );
}

function StepProvider({ form }: { form: SetupFormHook }) {
  const t = useTranslations('auth.setup');
  return (
    <div className="space-y-5 rise">
      <ProviderIntro />
      <ProviderChips form={form} />
      <ProviderKeyField form={form} />
      <ProviderModelField form={form} />
      <p className="mono text-[10px] text-(--color-faint) tracking-[0.06em]">
        {t('providerSkip')}
      </p>
    </div>
  );
}

function ProviderIntro() {
  const t = useTranslations('auth.setup');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
        {t('providerEyebrow')}
      </div>
      <p className="reading text-(--color-muted) text-[14px] max-w-[40em] mb-3">
        {t('providerIntro')}
      </p>
    </div>
  );
}

function ProviderChips({ form }: { form: SetupFormHook }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SETUP_PROVIDERS.map((p) => (
        <ProviderChip
          key={p.id} id={p.id} label={p.label}
          on={form.form.aiProvider === p.id}
          onPick={() => form.pickProvider(p.id)}
        />
      ))}
    </div>
  );
}

function ProviderChip({ id, label, on, onPick }: {
  id: string; label: string; on: boolean; onPick: () => void;
}) {
  const base = 'mono text-[11px] tracking-[0.12em] uppercase px-3 py-1.5 border border-(--color-rule) rounded-[2px] cursor-pointer';
  const onCls = on
    ? 'bg-(--color-ink) text-(--color-paper) border-(--color-ink)'
    : 'text-(--color-muted) hover:text-(--color-ink)';
  return (
    <button
      type="button" onClick={onPick}
      data-testid={`setup-provider-${id}`}
      className={`${base} ${onCls}`}
    >
      {label}
    </button>
  );
}

function ProviderKeyField({ form }: { form: SetupFormHook }) {
  const p = form.provider;
  const hint = p.needsKey ? `get one at ${p.issuer}` : 'no key — runs locally';
  return (
    <Field label={`${p.label} api key`} hint={hint}>
      <input
        type="password" value={form.form.aiKey}
        onChange={(e) => form.setField('aiKey', e.target.value)}
        placeholder={p.prefix} disabled={!p.needsKey}
        data-testid="setup-ai-key" autoComplete="new-password"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 text-(--color-ink) placeholder:text-(--color-faint) mono text-[15px] tracking-[0.04em] disabled:opacity-60"
      />
    </Field>
  );
}

function ProviderModelField({ form }: { form: SetupFormHook }) {
  return (
    <Field label="model">
      <input
        type="text" value={form.form.aiModel}
        onChange={(e) => form.setField('aiModel', e.target.value)}
        data-testid="setup-ai-model"
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 text-(--color-ink) mono text-[15px] tracking-[0.02em]"
      />
    </Field>
  );
}

function StepVerify({ form }: { form: SetupFormHook }) {
  return (
    <div className="space-y-5 rise">
      <VerifyIntro />
      <CaptchaBlock form={form} />
      <SummaryBlock form={form} />
    </div>
  );
}

function VerifyIntro() {
  const t = useTranslations('auth.setup');
  return (
    <>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">
        {t('verifyEyebrow')}
      </div>
      <p className="reading text-(--color-muted) text-[14px] max-w-[40em]">
        {t('verifyIntro')}
      </p>
    </>
  );
}

function CaptchaBlock({ form }: { form: SetupFormHook }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] bg-(--color-surface)/40 p-4 flex items-baseline gap-4 flex-wrap">
      <span className="mono text-[22px] text-(--color-ink) tabular-nums tracking-[0.04em]">
        {form.captchaQ.text} =
      </span>
      <input
        type="text" inputMode="numeric"
        value={form.form.captcha}
        onChange={(e) => form.setField('captcha', e.target.value)}
        placeholder="?"
        data-testid="setup-captcha"
        autoFocus
        className="flex-1 bg-transparent border-b border-(--color-ink) py-2 text-(--color-ink) mono text-[20px] tracking-[0.04em] min-w-[60px]"
      />
    </div>
  );
}

function SummaryBlock({ form }: { form: SetupFormHook }) {
  const f = form.form;
  return (
    <div className="crosshair border border-(--color-rule) p-4 text-[13px] mono">
      <SummaryRow label="name" value={f.full} />
      <SummaryRow label="handle" value={f.handle} />
      <SummaryRow label="public url" value={f.publicUrl} />
      <SummaryRow label="email" value={f.email} />
      <SummaryRow
        label="ai"
        value={`${form.provider.label} · ${f.aiModel}${f.aiKey === '' ? ' (key not set)' : ''}`}
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className="text-(--color-muted) tracking-[0.18em] uppercase text-[10px] min-w-[80px]">
        {label}
      </span>
      <span className="text-(--color-ink) break-all">{value || <em className="text-(--color-faint)">—</em>}</span>
    </div>
  );
}

function SetupNav({ form }: { form: SetupFormHook }) {
  return (
    <div className="flex items-center justify-between pt-2">
      <BackBtn step={form.step} onBack={form.back} busy={form.busy} />
      <PrimaryBtn step={form.step} busy={form.busy} disabled={!form.canAdvance} />
    </div>
  );
}

function BackBtn({ step, onBack, busy }: { step: 1 | 2 | 3 | 4; onBack: () => void; busy: boolean }) {
  const t = useTranslations('auth.setup');
  return step === 1 ? <span /> : (
    <button
      type="button" onClick={onBack} disabled={busy}
      className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-ink)"
    >
      {t('back')}
    </button>
  );
}

function PrimaryBtn({
  step, busy, disabled,
}: { step: 1 | 2 | 3 | 4; busy: boolean; disabled: boolean }) {
  const final = step === 4;
  return (
    <button
      type="submit" disabled={busy || disabled}
      data-testid={final ? 'submit' : 'next'}
      className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      <PrimaryBtnLabel busy={busy} final={final} />
    </button>
  );
}

function PrimaryBtnLabel({ busy, final }: { busy: boolean; final: boolean }) {
  const t = useTranslations('auth.setup');
  return busy ? <>{t('claiming')}</> : final ? <>{t('claim')}</> : <>{t('next')}</>;
}

function FormError({ message }: { message: string | null }) {
  return message ? (
    <div className="mono text-[11px] tracking-[0.06em] text-(--color-accent)" data-testid="error">
      {message}
    </div>
  ) : null;
}
