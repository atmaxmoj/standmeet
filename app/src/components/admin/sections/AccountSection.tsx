// AccountSection —— /admin/account. Owner self-manages identity fields: full_name /
// email / password.
//
// Three independent form blocks; both email and password require the current
// password first. Frontend validation is shallow (it only blocks obvious
// errors; the backend usecase is the real guard).

'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { LocaleSwitch } from '@/components/page/LocaleSwitch';
import { EmailBlock } from '@/components/admin/sections/account/EmailBlock';
import { HandleEditor } from '@/components/admin/sections/page/HandleEditor';
import { PublicURLEditor } from '@/components/admin/sections/page/PublicURLEditor';
import { DomainEditor } from '@/components/admin/sections/page/DomainEditor';
import { BYOAIEditor } from '@/components/admin/sections/page/BYOAIEditor';
import {
  AcctBlock, PasswordField, SaveBtn,
} from '@/components/admin/sections/account/atoms';
import {
  fullNameSaveDisabled, passwordHintMessage, passwordSaveDisabled, recoveryRowView,
} from '@/lib/admin/account-form';
import { useAdminSession } from '@/lib/admin/use-admin-session';
import { pickHandle } from '@/lib/admin/use-handle';
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
        <SiteCard />
        <ByoaiCard />
        <InferenceCard />
        <LanguageCard />
      </div>
    </>
  );
}

// SiteCard —— where this instance lives on the web: public URL (QR / canonical),
// URL handle, and the custom-domain allow-list. Moved here from the old homepage
// editor when the homepage became a custom page — these are instance settings, not
// page content, so they belong with the owner's other settings.
function SiteCard() {
  const t = useTranslations('adminShell.account');
  const view = useSiteView();
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">{t('siteAddress')}</div>
      <div className="space-y-4">
        <PublicURLEditor current={view.publicURL} onChanged={view.setPublicURL} />
        <HandleEditor current={view.handle} onChanged={view.setHandle} />
        <DomainEditor handle={view.handle} />
      </div>
    </div>
  );
}

// ByoaiCard —— visitors without a code may chat with their own API key against the
// public corpus. The toggle is an instance setting; moved here with the site block.
function ByoaiCard() {
  const t = useTranslations('adminShell.account');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">{t('byoaiMode')}</div>
      <BYOAIEditor />
    </div>
  );
}

interface SiteView {
  handle: string;
  publicURL: string;
  setHandle: (h: string) => void;
  setPublicURL: (u: string) => void;
}

function useSiteView(): SiteView {
  const session = useAdminSession();
  const [handleOverride, setHandleOverride] = useState<string | null>(null);
  const [publicURLOverride, setPublicURLOverride] = useState<string | null>(null);
  const seed = readyOwnerSeed(session);
  return {
    handle: pickHandle(handleOverride, seed.handle),
    publicURL: publicURLOverride ?? seed.publicURL,
    setHandle: setHandleOverride,
    setPublicURL: setPublicURLOverride,
  };
}

function readyOwnerSeed(
  s: ReturnType<typeof useAdminSession>,
): { handle: string; publicURL: string } {
  return s.kind === 'ready'
    ? { handle: s.session.handle, publicURL: s.session.public_url }
    : { handle: '', publicURL: '' };
}

// LanguageCard —— the owner's interface language. Switching navigates to the `/<locale>/…` prefix
// (the same mechanism as the visitor top-bar switcher), which persists the choice via cookie, so
// the whole admin + the public pages follow it. The control lives here so it's in one settings home.
function LanguageCard() {
  const t = useTranslations('adminShell.account');
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 bg-(--color-surface)/50">
      <div className="sm-smallcaps mb-3">{t('language')}</div>
      <LocaleSwitch />
      <p className="text-[12px] text-(--color-muted) mt-3">{t('languageSub')}</p>
    </div>
  );
}

function pickFullName(s: ReturnType<typeof useAdminSession>): string {
  return s.kind === 'ready' ? s.session.full_name : '';
}

function pickEmail(s: ReturnType<typeof useAdminSession>): string {
  return s.kind === 'ready' ? s.session.email : '';
}

// pickPendingEmail —— whether an unconfirmed change exists. **Read from the session**,
// never store a second copy in the component: if the owner closes the tab and comes
// back, the pending state is still in the DB, but a component useState would be gone
// (a fact belongs to whoever produces it; everywhere else only queries it).
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

