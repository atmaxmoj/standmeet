// AccountSection —— /admin/account。owner 自助管理身份字段：full_name /
// email / password。
//
// 三个独立 form block；email 和 password 都先输当前密码再写。前端验证
// 最浅（前端只挡明显错的，最终 backend 在 usecase 兜）。

'use client';

import { useState } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Block } from '@/components/admin/sections/page/Block';
import {
  emailSaveDisabled, fullNameSaveDisabled, passwordHintMessage, passwordSaveDisabled,
} from '@/lib/admin/account-form';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useAccount, type AccountHook } from '@/lib/admin/use-account';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function AccountSection() {
  const session = useAdminSession();
  const account = useAccount();
  useEffectErrorToast(account.error);
  return (
    <>
      <SectionHeader kicker="settings · owner" title="account" />
      <Intro />
      <FullNameBlock hook={account} initialValue={pickFullName(session)} />
      <EmailBlock hook={account} initialValue={pickEmail(session)} />
      <PasswordBlock hook={account} />
    </>
  );
}

function pickFullName(s: ReturnType<typeof useAdminSession>): string {
  return s.kind === 'ready' ? s.session.full_name : '';
}

function pickEmail(s: ReturnType<typeof useAdminSession>): string {
  return s.kind === 'ready' ? s.session.email : '';
}

function Intro() {
  return (
    <p className="reading-tight text-(--color-muted) mb-6 text-[15px] max-w-[54em]">
      Your owner identity. Full name is shown anywhere the page asks &quot;who is this&quot;;
      email is your login. Password reset has a server-side fallback (&quot;standmeet
      password-reset&quot; on the host) if you ever lock yourself out.
    </p>
  );
}

// ─── full name block ───────────────────────────────────────

function FullNameBlock({ hook, initialValue }: { hook: AccountHook; initialValue: string }) {
  const [raw, setRaw] = useState(initialValue);
  const toast = useToast();
  return (
    <Block title="full name" blurb="Shown on the public page hero and signature line.">
      <div className="flex items-baseline gap-3 border-b border-(--color-rule) pb-1">
        <input
          type="text"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          data-testid="account-full-name-input"
          className="flex-1 min-w-0 bg-transparent py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
        />
        <SaveBtn
          testid="account-full-name-save"
          disabled={fullNameSaveDisabled(hook.pending, raw, initialValue)}
          label="save name"
          onClick={() => void runSaveFullName(hook, raw, toast)}
        />
      </div>
    </Block>
  );
}

async function runSaveFullName(
  hook: AccountHook, raw: string,
  toast: { success: (m: string) => void },
): Promise<void> {
  const next = await hook.updateFullName(raw);
  next && toast.success(`Full name updated to ${next}`);
}

// ─── email block ───────────────────────────────────────────

function EmailBlock({ hook, initialValue }: { hook: AccountHook; initialValue: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState(initialValue);
  const toast = useToast();
  const disabled = emailSaveDisabled(hook.pending, current, next, initialValue);
  return (
    <Block title="email"
      blurb="Your login identity. Changing it requires your current password.">
      <PasswordField
        testid="account-email-current-password"
        value={current} onChange={setCurrent} label="current password"
      />
      <div className="flex items-baseline gap-3 border-b border-(--color-rule) pb-1 mt-3">
        <input
          type="email"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          spellCheck={false}
          autoComplete="email"
          placeholder="you@example.com"
          data-testid="account-email-new"
          className="flex-1 min-w-0 bg-transparent py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
        />
        <SaveBtn
          testid="account-email-save"
          disabled={disabled}
          label="save email"
          onClick={() => void runSaveEmail(hook, current, next, setCurrent, toast)}
        />
      </div>
    </Block>
  );
}

async function runSaveEmail(
  hook: AccountHook, current: string, next: string,
  setCurrent: (v: string) => void,
  toast: { success: (m: string) => void },
): Promise<void> {
  const saved = await hook.updateEmail(current, next);
  saved && finishEmailSave(setCurrent, toast, saved);
}

function finishEmailSave(
  setCurrent: (v: string) => void,
  toast: { success: (m: string) => void },
  saved: string,
): void {
  setCurrent('');
  toast.success(`Email updated to ${saved}`);
}

// ─── password block ────────────────────────────────────────

function PasswordBlock({ hook }: { hook: AccountHook }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const toast = useToast();
  const disabled = passwordSaveDisabled(hook.pending, current, next, confirm);
  return (
    <Block title="password"
      blurb="At least 12 characters. Existing sessions stay valid — log out manually elsewhere if needed.">
      <PasswordField testid="account-password-current"
        value={current} onChange={setCurrent} label="current password" />
      <PasswordField testid="account-password-new"
        value={next} onChange={setNext} label="new password (≥ 12 chars)" />
      <PasswordField testid="account-password-confirm"
        value={confirm} onChange={setConfirm} label="confirm new password" />
      <PasswordHint next={next} confirm={confirm} />
      <div className="mt-2 flex items-baseline justify-end">
        <SaveBtn
          testid="account-password-save"
          disabled={disabled}
          label="save password"
          onClick={() => void runSavePassword(hook, current, next,
            () => { setCurrent(''); setNext(''); setConfirm(''); }, toast)}
        />
      </div>
    </Block>
  );
}

function PasswordHint({ next, confirm }: { next: string; confirm: string }) {
  const message = passwordHintMessage(next, confirm);
  return message
    ? <p className="mono text-[10.5px] tracking-[0.04em] text-(--color-accent) mt-1">{message}</p>
    : null;
}

async function runSavePassword(
  hook: AccountHook, current: string, next: string,
  clear: () => void, toast: { success: (m: string) => void },
): Promise<void> {
  const ok = await hook.updatePassword(current, next);
  ok && finishPasswordSave(clear, toast);
}

function finishPasswordSave(
  clear: () => void, toast: { success: (m: string) => void },
): void {
  clear();
  toast.success('Password updated');
}

// ─── shared atoms ──────────────────────────────────────────

interface PasswordFieldProps {
  testid: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}

function PasswordField({ testid, value, onChange, label }: PasswordFieldProps) {
  return (
    <label className="block mt-3">
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-1">
        {label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        data-testid={testid}
        className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
      />
    </label>
  );
}

interface SaveBtnProps {
  testid: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
}

function SaveBtn({ testid, disabled, label, onClick }: SaveBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-ink) px-2.5 py-1 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
    >
      {label}
    </button>
  );
}
