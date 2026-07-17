// RequestPanel —— gate "no code? leave a note" 双列：左侧解释 + 右侧表单。
// 设计稿的展示：默认折叠成一个 "write a note ↘" 按钮，点了再展开整个表单。
// 提交成功后变 "sent" 视觉 + 个性化致谢。
//
// 提交走 hook.submitRequest → POST /api/v1/access-requests(backend 落 audit log)。
// 非 stub,covered by gate-request-access.spec.ts。

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import type { AccessRequestInput, GateHook } from '@/lib/gate/use-gate';

type Props = {
  handle: string;
  hook: GateHook;
};

type FormState = { name: string; org: string; email: string; why: string };

const EMPTY: FormState = { name: '', org: '', email: '', why: '' };
const WHY_MIN = 15;

export function RequestPanel({ handle, hook }: Props) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const setField = useCallback((key: keyof FormState, v: string) => {
    setForm((prev) => ({ ...prev, [key]: v }));
  }, []);

  const onSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const input: AccessRequestInput = {
      name: form.name,
      org: form.org,
      email: form.email,
      message: form.why,
    };
    const ok = await hook.submitRequest(input);
    setSent(ok);
  }, [form, hook]);

  return (
    <section id="request" className="mt-20 pt-14 border-t border-(--color-rule)" data-testid="request-panel">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10">
        <RequestHeadline handle={handle} open={open} sent={sent} onOpen={() => setOpen(true)} />
        <RequestRight
          open={open} sent={sent} form={form} setField={setField}
          onSubmit={onSubmit} busy={hook.state.busy}
        />
      </div>
    </section>
  );
}

function RequestHeadline({
  handle, open, sent, onOpen,
}: { handle: string; open: boolean; sent: boolean; onOpen: () => void }) {
  const t = useTranslations('gate');
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-3">
        {t('common.noCode')}
      </div>
      <h2 className="font-serif text-(--color-ink) text-[28px] font-normal tracking-[-0.015em] leading-[1.1]">
        {t('request.headline', { handle })}<span className="text-(--color-accent)">.</span>
      </h2>
      <p className="reading text-(--color-muted) mt-3 text-[15.5px]">
        {t('request.lede')}
      </p>
      <OpenButton show={!open && !sent} onOpen={onOpen} />
    </div>
  );
}

function OpenButton({ show, onOpen }: { show: boolean; onOpen: () => void }) {
  const t = useTranslations('gate.request');
  return show ? (
    <button
      type="button"
      onClick={onOpen}
      className="mt-5 mono text-[11px] tracking-[0.16em] uppercase text-(--color-ink) border border-(--color-ink) px-3.5 py-2 hover:bg-(--color-ink) hover:text-(--color-paper) transition-colors"
    >
      {t('openButton')}
    </button>
  ) : null;
}

type RightProps = {
  open: boolean;
  sent: boolean;
  form: FormState;
  setField: (k: keyof FormState, v: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  busy: boolean;
};

function RequestRight(p: RightProps) {
  return p.sent
    ? <SentConfirmation name={p.form.name} email={p.form.email} />
    : p.open ? <RequestForm {...p} /> : null;
}

function RequestForm(p: RightProps) {
  return (
    <form onSubmit={p.onSubmit} className="rise space-y-5">
      <NameField value={p.form.name} onChange={(v) => p.setField('name', v)} />
      <div className="grid grid-cols-2 gap-5">
        <OrgField value={p.form.org} onChange={(v) => p.setField('org', v)} />
        <EmailField value={p.form.email} onChange={(v) => p.setField('email', v)} />
      </div>
      <WhyField value={p.form.why} onChange={(v) => p.setField('why', v)} />
      <FormFooter why={p.form.why} busy={p.busy} valid={isValid(p.form)} />
    </form>
  );
}

function isValid(form: FormState): boolean {
  return form.name.trim() !== '' && form.email.trim() !== '' && form.why.trim().length > WHY_MIN;
}

function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('gate.common');
  return (
    <RequestField label={t('yourName')} required>
      <TextInput
        value={value} onChange={onChange} testid="request-name" placeholder="first + last is fine"
      />
    </RequestField>
  );
}

function OrgField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('gate.request');
  return (
    <RequestField label={t('orgLabel')}>
      <TextInput
        value={value} onChange={onChange} testid="request-org" placeholder="company / lab / project"
      />
    </RequestField>
  );
}

function EmailField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('gate.request');
  return (
    <RequestField label={t('emailLabel')} required>
      <TextInput
        value={value} onChange={onChange} testid="request-email" placeholder="for the code" type="email"
      />
    </RequestField>
  );
}

function WhyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTranslations('gate.request');
  return (
    <RequestField label={t('whyLabel')} required>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        data-testid="request-message"
        placeholder="two or three sentences. specific."
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-(--color-ink) placeholder:text-(--color-faint) resize-none text-[16px] leading-[1.55]"
      />
      <CharCount value={value} />
    </RequestField>
  );
}

function CharCount({ value }: { value: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.12em] text-(--color-faint) mt-1.5">
      <span className={value.length > WHY_MIN ? 'text-(--color-muted)' : 'text-(--color-faint)'}>
        {value.length}
      </span>
      {' / ~ 200'}
    </div>
  );
}

function FormFooter({ why: _why, busy, valid }: { why: string; busy: boolean; valid: boolean }) {
  const t = useTranslations('gate.request');
  return (
    <div className="flex items-center justify-between pt-2">
      <span className="mono text-[10px] tracking-[0.12em] text-(--color-faint)">
        {t('footerNote')}
      </span>
      <button
        type="submit"
        disabled={!valid || busy}
        data-testid="request-submit"
        className="mono text-[11px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-4 py-2.5 hover:bg-(--color-accent) transition-colors disabled:opacity-30"
      >
        {busy ? t('sending') : t('send')}
      </button>
    </div>
  );
}

// accent —— sent 文案里 email 的 rich tag。
const accent = (chunks: ReactNode) => <span className="text-(--color-accent)">{chunks}</span>;

function SentConfirmation({ name, email }: { name: string; email: string }) {
  const t = useTranslations('gate.request');
  const first = name.split(' ')[0] || t('anonVisitor');
  return (
    <div className="rise" data-testid="request-sent">
      <div className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-accent) mb-3">{t('sent')}</div>
      <p className="reading text-(--color-ink) text-[17px]">
        {t.rich('sentBody', { name: first, email, accent })}
      </p>
      <p className="reading text-(--color-muted) mt-4 text-[15.5px]">
        {t('sentTail')}
      </p>
    </div>
  );
}

function RequestField({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5">
        {label}
        {required && <span className="text-(--color-accent) ml-1">*</span>}
      </div>
      {children}
    </div>
  );
}

type TextInputProps = {
  value: string;
  onChange: (v: string) => void;
  testid: string;
  placeholder?: string;
  type?: 'text' | 'email';
};

function TextInput({ value, onChange, testid, placeholder, type = 'text' }: TextInputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testid}
      className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading text-(--color-ink) placeholder:text-(--color-faint) text-[16px]"
    />
  );
}
