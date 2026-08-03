// AccountSection —— /admin/account。owner 自助管理身份字段：full_name /
// email / password。
//
// 三个独立 form block；email 和 password 都先输当前密码再写。前端验证
// 最浅（前端只挡明显错的，最终 backend 在 usecase 兜）。

'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import {
  emailSaveDisabled, fullNameSaveDisabled, passwordHintMessage, passwordSaveDisabled,
  recoveryRowView,
} from '@/lib/admin/account-form';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { useAccount, type AccountHook } from '@/lib/admin/use-account';
import { adminAPI } from '@/lib/api/admin';
import { useOutbound } from '@/lib/admin/use-outbound';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function AccountSection() {
  const session = useAdminSession();
  const account = useAccount();
  useEffectErrorToast(account.error);
  return (
    <>
      <SectionHeader kicker="settings · owner" title="account" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ProfileCard hook={account} session={session} />
        <SecurityCard hook={account} />
        <InferenceCard />
      </div>
    </>
  );
}

function pickFullName(s: ReturnType<typeof useAdminSession>): string {
  return s.kind === 'ready' ? s.session.full_name : '';
}

function pickEmail(s: ReturnType<typeof useAdminSession>): string {
  return s.kind === 'ready' ? s.session.email : '';
}

// AcctBlock —— like the page Block but WITHOUT its section border-t. The account
// fields already separate with their own input underlines, so the extra divider
// (only the 2nd block in a card picked it up — e.g. above "email") read redundant.
function AcctBlock({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-7 flex items-baseline gap-4 flex-wrap">
        <h2 className="font-serif text-(--color-ink) text-[22px] font-medium tracking-[-0.012em]">{title}</h2>
        {blurb ? (
          <p className="reading-tight text-(--color-muted) flex-1 min-w-[20em] text-[14px] max-w-[46em]">{blurb}</p>
        ) : null}
      </div>
      <div className="space-y-7">{children}</div>
    </section>
  );
}

function ProfileCard({ hook, session }: { hook: AccountHook; session: ReturnType<typeof useAdminSession> }) {
  const t = useTranslations('adminShell.account');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">{t('profile')}</div>
      <FullNameBlock hook={hook} initialValue={pickFullName(session)} />
      <EmailBlock hook={hook} initialValue={pickEmail(session)} />
    </div>
  );
}

function SecurityCard({ hook }: { hook: AccountHook }) {
  const t = useTranslations('adminShell.account');
  const canDeliver = useOutbound().status?.connected ?? false;
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">{t('security')}</div>
      <PasswordBlock hook={hook} />
      <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-(--color-rule)/60">
        <RecoveryRow canDeliver={canDeliver} />
      </div>
    </div>
  );
}

// RecoveryRow —— generate a recovery phrase (emailed to the owner). Enabled only once a mail
// connector is verified (recoveryRowView owns that copy/gating); the button POSTs and toasts.
function RecoveryRow({ canDeliver }: { canDeliver: boolean }) {
  const view = recoveryRowView(canDeliver);
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const generate = useCallback(async () => {
    setSending(true);
    try {
      await adminAPI.postVoid('/account/recovery', {});
      toast.success('Recovery phrase sent');
    } catch {
      toast.error("Couldn't send the recovery phrase — set up and verify an outbound channel first");
    } finally {
      setSending(false);
    }
  }, [toast]);
  return (
    <SecurityRow
      label="Recovery phrase" detail={view.detail} actionLabel="generate" note={view.note}
      onAction={canDeliver ? generate : undefined}
      disabled={!canDeliver || sending}
    />
  );
}

interface SecurityRowProps {
  label: string;
  detail: string;
  actionLabel: string;
  // note —— why the action is disabled; shown in a ⓘ tooltip next to the label.
  note: string;
  // onAction —— click handler; when omitted the row is a disabled placeholder.
  onAction?: () => void;
  disabled?: boolean;
}

function SecurityRow({ label, detail, actionLabel, note, onAction, disabled = true }: SecurityRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-(--color-rule)/60 last:border-b-0">
      <div>
        <div className="font-serif text-[15px] text-(--color-ink) flex items-center gap-1.5">
          {label}
          <InfoDot note={note} />
        </div>
        <div className="mono text-[10px] text-(--color-muted) mt-0.5">{detail}</div>
      </div>
      <button
        className="sm-btn sm-btn-outline sm-btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
        type="button" disabled={disabled} title={note} onClick={onAction}
        data-testid="recovery-generate"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function InfoDot({ note }: { note: string }) {
  return (
    <span
      title={note}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-(--color-muted)/50 text-(--color-muted) mono text-[8px] leading-none cursor-help"
    >
      ?
    </span>
  );
}

function InferenceCard() {
  const t = useTranslations('adminShell.account');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">{t('inference')}</div>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">{t('defaultProvider')}</div>
          <div className="mono text-[12px] text-(--color-ink)">{t('configuredIn')}</div>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2 border-t border-(--color-rule)/60">
          <div>
            <div className="font-serif text-[15px] text-(--color-ink)">{t('spend30d')}</div>
            <div className="mono text-[10px] text-(--color-faint) mt-0.5">{t('spendSub')}</div>
          </div>
          <span className="mono text-[16px] text-(--color-ink)">{t('spendUnknown')}</span>
        </div>
      </div>
    </div>
  );
}

// ─── full name block ───────────────────────────────────────

function FullNameBlock({ hook, initialValue }: { hook: AccountHook; initialValue: string }) {
  const [raw, setRaw] = useState(initialValue);
  const toast = useToast();
  return (
    <AcctBlock title="full name" blurb="Shown on the public page hero and signature line.">
      <div className="flex items-baseline gap-3">
        <input
          type="text"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          data-testid="account-full-name-input"
          className="flex-1 min-w-0 bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
        />
        <SaveBtn
          testid="account-full-name-save"
          disabled={fullNameSaveDisabled(hook.pending, raw, initialValue)}
          label="save name"
          onClick={() => void runSaveFullName(hook, raw, toast)}
        />
      </div>
    </AcctBlock>
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
    <AcctBlock title="email"
      blurb="Your login identity. Changing it requires your current password.">
      <PasswordField
        testid="account-email-current-password"
        value={current} onChange={setCurrent} label="current password"
      />
      <div className="flex items-baseline gap-3 mt-3">
        <input
          type="email"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          spellCheck={false}
          autoComplete="email"
          placeholder="you@example.com"
          data-testid="account-email-new"
          className="flex-1 min-w-0 bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-1.5 reading-tight text-[17px] font-medium tracking-[-0.005em]"
        />
        <SaveBtn
          testid="account-email-save"
          disabled={disabled}
          label="save email"
          onClick={() => void runSaveEmail(hook, current, next, setCurrent, toast)}
        />
      </div>
    </AcctBlock>
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
    <AcctBlock title="password"
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
    </AcctBlock>
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
