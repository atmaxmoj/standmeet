// MailConnectorPanel —— owner-facing outbound SMTP connector card.
// 三块:
//   1. status badge (connected / configured · verify email / not configured)
//   2. credentials form (host / port / username / password / from)
//   3. OTP verify (发 6 位码到 from → 输对才 connected) + Disconnect
//
// 设计稿没专门画 mail 卡,沿用 CalendarConnectorPanel 的视觉语言
// (crosshair + mono kicker + 字段一列),布局窄一档 (max-w-[640px])。

'use client';

import { useState } from 'react';

import {
  useMail, useMailStore, sendCodeLabel, mailActionsView,
  type MailCredsInput, type MailHook,
} from '@/lib/admin/use-mail';

type FormState = Record<'host' | 'port' | 'username' | 'password' | 'fromAddress' | 'fromName', string>;

const EMPTY_FORM: FormState = {
  host: '', port: '', username: '', password: '', fromAddress: '', fromName: '',
};

export function MailConnectorPanel() {
  const hook = useMail();
  return (
    <section
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5 max-w-[640px]"
      data-testid="mail-connector-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <Header status={hook.status} />
      <CredentialsForm hook={hook} />
      <Actions hook={hook} />
    </section>
  );
}

function Header({ status }: { status: MailHook['status'] }) {
  return (
    <div className="flex items-baseline justify-between mb-4">
      <h3 className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted)">
        Outbound email (SMTP)
      </h3>
      <StatusBadge status={status} />
    </div>
  );
}

function StatusBadge({ status }: { status: MailHook['status'] }) {
  return status === null
    ? null
    : <Badge tone={badgeTone(status)} text={badgeText(status)} />;
}

function badgeTone(s: NonNullable<MailHook['status']>): 'ok' | 'warn' | 'muted' {
  return s.connected ? 'ok' : s.has_credentials ? 'warn' : 'muted';
}

function badgeText(s: NonNullable<MailHook['status']>): string {
  return s.connected
    ? 'connected'
    : s.has_credentials
      ? 'configured · verify email'
      : 'not configured';
}

function Badge({ tone, text }: { tone: 'ok' | 'warn' | 'muted'; text: string }) {
  const color = tone === 'ok' ? 'text-(--color-accent)'
    : tone === 'warn' ? 'text-(--color-ink)'
      : 'text-(--color-faint)';
  return (
    <span
      className={`mono text-[10.5px] tracking-[0.10em] ${color}`}
      data-testid="mail-status-badge"
    >
      {text}
    </span>
  );
}

// ─── credentials form ─────────────────────────────────────────

function CredentialsForm({ hook }: { hook: MailHook }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="space-y-3 mb-5">
      <CredentialsHint />
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <MailField label="host" testid="mail-host" value={form.host}
          onChange={set('host')} placeholder="smtp.gmail.com" />
        <MailField label="port" testid="mail-port" value={form.port}
          onChange={set('port')} placeholder="587" />
      </div>
      <MailField label="username" testid="mail-username" value={form.username}
        onChange={set('username')} placeholder="you@gmail.com (blank if none)" />
      <MailField label="password" type="password" testid="mail-password" value={form.password}
        onChange={set('password')} placeholder="app password" />
      <MailField label="from address" testid="mail-from-address" value={form.fromAddress}
        onChange={set('fromAddress')} placeholder="you@yourdomain.com" />
      <MailField label="from name" testid="mail-from-name" value={form.fromName}
        onChange={set('fromName')} placeholder="Your Name (optional)" />
      <SaveCredsButton hook={hook} form={form} />
    </div>
  );
}

function CredentialsHint() {
  return (
    <p className="reading-tight text-[12.5px] text-(--color-muted) italic">
      Your own SMTP server — Gmail app password, Postmark, Fastmail, etc. Used to email
      an access code when you approve a request. Username/password are encrypted at rest.
    </p>
  );
}

function MailField({
  label, testid, value, onChange, placeholder, type = 'text',
}: {
  label: string;
  testid: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: 'text' | 'password';
}) {
  return (
    <label className="block">
      <span className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) block mb-1">
        {label}
      </span>
      <input
        type={type}
        data-testid={testid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px]"
      />
    </label>
  );
}

function SaveCredsButton({ hook, form }: { hook: MailHook; form: FormState }) {
  const disabled = form.host.trim() === '' || form.port.trim() === '' || form.fromAddress.trim() === '';
  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="mail-save-credentials"
      onClick={() => { void hook.saveCredentials(toCredsInput(form)); }}
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      Save SMTP config
    </button>
  );
}

function toCredsInput(form: FormState): MailCredsInput {
  return {
    host: form.host.trim(),
    port: parseInt(form.port, 10) || 0,
    username: form.username.trim(),
    password: form.password,
    from_address: form.fromAddress.trim(),
    from_name: form.fromName.trim(),
  };
}

// ─── OTP verify / disconnect ──────────────────────────────────
// Send a 6-digit code to the from address, type it back to verify the owner
// actually receives mail (not just that the SMTP creds accept a send).

// Actions —— three states: no creds → nothing; configured-but-unverified → the
// send/verify flow; verified → only a 'verified' line + Disconnect (no resend, no
// verify until you disconnect). The connected branch is also what replaces the
// transient send/verify messages once verification succeeds. The which-view
// decision is a pure helper (mailActionsView) so this stays a thin renderer.
function Actions({ hook }: { hook: MailHook }) {
  const view = mailActionsView(hook.status);
  return view === 'none' ? null : view === 'connected' ? <ConnectedRow /> : <VerifyRow />;
}

function ConnectedRow() {
  return (
    <div className="flex items-center gap-3 mb-1">
      <span
        data-testid="mail-verified"
        className="mono text-[11px] tracking-[0.08em] uppercase text-(--color-accent)"
      >
        ✓ email verified
      </span>
      <DisconnectBtn />
    </div>
  );
}

function VerifyRow() {
  const code = useMailStore((s) => s.code);
  const msg = useMailStore((s) => s.msg);
  const setCode = useMailStore((s) => s.setCode);
  const verifyCode = useMailStore((s) => s.verifyCode);
  return (
    <div className="space-y-2 mb-1">
      <div className="flex flex-wrap gap-2 items-end">
        <SendCodeBtn />
        <CodeInput value={code} onChange={setCode} />
        <VerifyBtn code={code} onClick={() => { void verifyCode(); }} />
        <DisconnectBtn />
      </div>
      <ActionMsg msg={msg} />
    </div>
  );
}

function SendCodeBtn() {
  const cooldown = useMailStore((s) => s.cooldown);
  const sent = useMailStore((s) => s.sent);
  const sendCode = useMailStore((s) => s.sendCode);
  return (
    <button
      type="button" data-testid="mail-send-otp"
      disabled={cooldown > 0} onClick={() => { void sendCode(); }}
      className="sm-btn sm-btn-ghost sm-btn-sm disabled:opacity-40"
    >
      {sendCodeLabel(cooldown, sent)}
    </button>
  );
}

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text" inputMode="numeric" maxLength={6} placeholder="6-digit code"
      data-testid="mail-otp-code" value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      className="w-[120px] bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 mono text-[13px] tracking-[0.2em]"
    />
  );
}

function VerifyBtn({ code, onClick }: { code: string; onClick: () => void }) {
  return (
    <button type="button" data-testid="mail-verify-otp" disabled={code.length !== 6} onClick={onClick}
      className="sm-btn sm-btn-solid sm-btn-sm disabled:opacity-40">
      Verify
    </button>
  );
}

function ActionMsg({ msg }: { msg: string | null }) {
  return msg === null
    ? null
    : <p className="mono text-[11.5px] text-(--color-muted)" data-testid="mail-otp-result">{msg}</p>;
}

// disconnect lives on the store; it also resets the OTP flow (clears any pending
// code + cooldown) so re-verifying after a disconnect starts clean.
function DisconnectBtn() {
  const disconnect = useMailStore((s) => s.disconnect);
  return (
    <button
      type="button"
      data-testid="mail-disconnect"
      onClick={() => { void disconnect(); }}
      className="sm-btn sm-btn-ghost sm-btn-sm"
    >
      Disconnect
    </button>
  );
}
