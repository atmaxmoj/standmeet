// RequestPanel —— gate "no code? leave a note" 双列：左侧解释 + 右侧表单。
// 设计稿的展示：默认折叠成一个 "write a note ↘" 按钮，点了再展开整个表单。
// 提交成功后变 "sent" 视觉 + 个性化致谢。
//
// 提交走 hook.submitRequest → POST /api/v1/access-requests(backend 落 audit log)。
// 非 stub,covered by gate-request-access.spec.ts。

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
  // captchaToken —— 发得太多被拦下之后那道校验出的票（F-G-4）。
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

// 外面这层 div 不是多余的：按钮是 grid 的直接子项，而 grid item 默认拉伸 ——
// `inline-flex` 挡不住它，`sm-btn-outline` 的边框会被抻成一个占满整格的大空框。
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

// RequestRight —— 右栏永远有东西。
//
// 折叠态下这一栏原本渲染 `null`，而「写一张便条」那个按钮挂在左栏文案末尾 —— 于是整页
// 最后一段是一个窄左栏 + 约 60% 空白右栏，读起来像右半边没加载出来（UX-38）。
// 按钮搬到**表单将要出现的那个位置**：折叠时它是那一栏的内容，点开后就地长成表单。
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
      {/* 发得太多被拦下之后才出现：没被拦时拦一道校验，是拿防线去烦一个只想说句话的人。
          后端本来就认这张票（`request_guard.go`），这里把那条出路显出来（F-G-4）。 */}
      {/* 先说被拒的理由，再给那个校验框 —— 状态在前，补救在后。理由这句话贴着被拒的那张表：
          以前它落在整页最底下那个共用的错误行里，既离得远，又同时印在「输入访问码」那一栏
          下面（F-G-6）。 */}
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

// FloodCaptcha —— 被拦下时那道人机校验。两个条件缺一不可：这台实例真配了 captcha
// （没有 site key 就渲染不出来，也没必要），而且这次提交真的被拦了。
function FloodCaptcha(
  { locked, onToken }: { locked: boolean; onToken: (t: string) => void },
) {
  const captcha = useCaptchaSiteKey();
  return locked && captcha.siteKey !== ''
    ? <FloodCaptchaBox siteKey={captcha.siteKey} onToken={onToken} />
    : null;
}

// FloodCaptchaBox —— 只有那个校验框。说明由后端那句拒绝给（`RequestError` 就在它上面一行），
// 理由同 CodePanel 的 LockedCaptchaBox：两句措辞不同的话说同一件事，读的人会以为是两件事。
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
