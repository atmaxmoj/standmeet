// AccountSection —— /admin/account。owner 自助管理身份字段：full_name /
// email / password。
//
// 三个独立 form block；email 和 password 都先输当前密码再写。前端验证
// 最浅（前端只挡明显错的，最终 backend 在 usecase 兜）。

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { EmailBlock } from '@/components/admin/sections/account/EmailBlock';
import {
  AcctBlock, PasswordField, SaveBtn,
} from '@/components/admin/sections/account/atoms';
import {
  fullNameSaveDisabled, passwordHintMessage, passwordSaveDisabled, recoveryRowView,
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
      <SectionHeader kicker="settings · owner" slug="account" />
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

// pickPendingEmail —— 有没有一次待确认的改动。**从 session 读**,不在组件里另存一份:
// owner 关掉标签页再回来,那个待确认状态还在库里,而组件的 useState 早没了
// (事实归产生它的那一方,别处只查询不记忆)。
function pickPendingEmail(s: ReturnType<typeof useAdminSession>): string {
  return s.kind === 'ready' ? (s.session.pendingEmail ?? '') : '';
}


function ProfileCard({ hook, session }: { hook: AccountHook; session: ReturnType<typeof useAdminSession> }) {
  const t = useTranslations('adminShell.account');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">{t('profile')}</div>
      <FullNameBlock hook={hook} initialValue={pickFullName(session)} />
      <EmailBlock
        hook={hook} initialValue={pickEmail(session)}
        pending={pickPendingEmail(session)}
      />
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
    <div
      data-testid="recovery-row"
      className="flex items-baseline justify-between gap-3 py-2 border-b border-(--color-rule)/60 last:border-b-0"
    >
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
          className="sm-field-input sm-field-lg flex-1 min-w-0"
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

