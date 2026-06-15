// AccountSection —— /admin/account。owner 自助管理身份字段：full_name /
// email / password。
//
// 三个独立 form block；email 和 password 都先输当前密码再写。前端验证
// 最浅（前端只挡明显错的，最终 backend 在 usecase 兜）。

'use client';

import { useState, type ReactNode } from 'react';

import { SectionHeader } from '@/components/admin/SectionHeader';
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
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">profile</div>
      <FullNameBlock hook={hook} initialValue={pickFullName(session)} />
      <EmailBlock hook={hook} initialValue={pickEmail(session)} />
    </div>
  );
}

function SecurityCard({ hook }: { hook: AccountHook }) {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">security</div>
      <PasswordBlock hook={hook} />
      <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-(--color-rule)/60">
        <SecurityRow label="Two-factor" detail="○ off" actionLabel="enable" />
        <SecurityRow label="Recovery phrase" detail="not yet set" actionLabel="generate" />
      </div>
    </div>
  );
}

function SecurityRow({ label, detail, actionLabel }: { label: string; detail: string; actionLabel: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-(--color-rule)/60 last:border-b-0">
      <div>
        <div className="font-serif text-[15px] text-(--color-ink)">{label}</div>
        <div className="mono text-[10px] text-(--color-muted) mt-0.5">{detail}</div>
      </div>
      <button className="sm-btn sm-btn-outline sm-btn-sm" type="button">{actionLabel}</button>
    </div>
  );
}

function InferenceCard() {
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">inference</div>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1">default provider</div>
          <div className="mono text-[12px] text-(--color-ink)">configured in /admin/api-mcp</div>
        </div>
        <div className="flex items-baseline justify-between gap-3 py-2 border-t border-(--color-rule)/60">
          <div>
            <div className="font-serif text-[15px] text-(--color-ink)">30-day spend</div>
            <div className="mono text-[10px] text-(--color-faint) mt-0.5">your inference key · owner pays</div>
          </div>
          <span className="mono text-[16px] text-(--color-ink)">$—</span>
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
