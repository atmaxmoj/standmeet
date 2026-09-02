// RequestPanel — the gate's "no code? leave a note" two-column layout: explanation
// on the left, form on the right.
// Per the design mockup: collapses by default into a "write a note ↘" button;
// clicking it expands the full form. A successful submit switches to "sent"
// visuals + a personalized thank-you.
//
// Submit goes through hook.submitRequest -> POST /api/v1/access-requests (backend
// writes an audit log). Not a stub — covered by gate-request-access.spec.ts.

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { useCaptchaSiteKey } from '@/lib/auth/use-captcha-site-key';
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
  // captchaToken — the ticket issued by the challenge that appears after sending
  // too many requests (F-G-4).
  const [captchaToken, setCaptchaToken] = useState('');

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
      ...(captchaToken === '' ? {} : { captcha_token: captchaToken }),
    };
    const ok = await hook.submitRequest(input);
    setSent(ok);
  }, [form, hook, captchaToken]);

  return (
    <section id="request" className="mt-20 pt-14 border-t border-(--color-rule)" data-testid="request-panel">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-10">
        <RequestHeadline handle={handle} />
        <RequestRight
          open={open} sent={sent} form={form} setField={setField}
          onSubmit={onSubmit} busy={hook.request.busy} onOpen={() => setOpen(true)}
          error={hook.request.error}
          locked={hook.request.locked} captchaToken={captchaToken} onToken={setCaptchaToken}
        />
      </div>
    </section>
  );
}

function RequestHeadline({ handle }: { handle: string }) {
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
    </div>
  );
}

// This outer div isn't redundant: the button is a direct grid child, and a grid
// item stretches by default — `inline-flex` doesn't stop it, and `sm-btn-outline`'s
// border would get stretched into a big empty box filling the whole cell.
function OpenButton({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('gate.request');
  return (
    <div>
      <button type="button" onClick={onOpen} className="sm-btn sm-btn-outline">
        {t('openButton')}
      </button>
    </div>
  );
}

type RightProps = {
  open: boolean;
  sent: boolean;
  form: FormState;
  setField: (k: keyof FormState, v: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  busy: boolean;
  onOpen: () => void;
  error: string | null;
  locked: boolean;
  captchaToken: string;
  onToken: (t: string) => void;
};

// RequestRight — the right column always has something in it.
//
// While collapsed, this column used to render `null`, with the "write a note"
// button tacked onto the end of the left column's copy — so the page's final
// section ended up as a narrow left column plus roughly 60% blank right column,
// which reads as if the right half failed to load (UX-38).
// The button moved to **the spot where the form will appear**: while collapsed it
// is that column's content, and clicking it grows the form in place.
function RequestRight(p: RightProps) {
  return p.sent
    ? <SentConfirmation name={p.form.name} email={p.form.email} />
    : p.open ? <RequestForm {...p} /> : <OpenButton onOpen={p.onOpen} />;
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
      {/* Appears only after being throttled for sending too much: showing the
          challenge before that would run the product's defense against someone
          who just wants to say something. The backend already accepts this
          ticket (`request_guard.go`); this just surfaces that path (F-G-4). */}
      {/* State the rejection reason before offering the challenge — status first,
          remedy second. The reason sits right against the form that got
          rejected: it used to sit in the shared error line at the very bottom of
          the page, both far away and printed right under the "enter access
          code" column (F-G-6). */}
      <RequestError message={p.error} />
      <FloodCaptcha locked={p.locked} onToken={p.onToken} />
      <FormFooter
        why={p.form.why} busy={p.busy}
        valid={isValid(p.form) && !(p.locked && p.captchaToken === '')}
      />
    </form>
  );
}

function RequestError({ message }: { message: string | null }) {
  return message === null ? null : (
    <p
      className="mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-accent)"
      data-testid="request-error"
    >
      {message}
    </p>
  );
}

// FloodCaptcha — the human-verification challenge shown when throttled. Both
// conditions are required: this instance actually has captcha configured
// (without a site key it can't render, and it's unneeded), and this submission
// was actually throttled.
function FloodCaptcha(
  { locked, onToken }: { locked: boolean; onToken: (t: string) => void },
) {
  const captcha = useCaptchaSiteKey();
  return locked && captcha.siteKey !== ''
    ? <FloodCaptchaBox siteKey={captcha.siteKey} onToken={onToken} />
    : null;
}

// FloodCaptchaBox — just the challenge widget. The explanation comes from the
// backend's rejection message (`RequestError` sits right above it) — same
// reasoning as CodePanel's LockedCaptchaBox: two differently-worded sentences
// saying the same thing would read to the viewer as two separate things.
function FloodCaptchaBox(
  { siteKey, onToken }: { siteKey: string; onToken: (t: string) => void },
) {
  return (
    <div data-testid="request-captcha">
      <TurnstileWidget siteKey={siteKey} onToken={onToken} />
    </div>
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
        className="sm-btn sm-btn-solid"
      >
        {busy ? t('sending') : t('send')}
      </button>
    </div>
  );
}

// accent — the rich tag for the email in the sent copy.
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
      className="sm-field-input"
    />
  );
}
