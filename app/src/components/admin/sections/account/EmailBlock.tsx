// EmailBlock — the change-email piece on /admin/account.
//
// It's thicker than the other two blocks because changing email isn't a one-field change:
// the email column is both **login identity** and **where the recovery phrase is sent**,
// so changing it moves both at once. That's why three things live only here —
//   1. Type it twice (password change already required this; this equally dangerous field
//      on the same panel didn't — that was a bug)
//   2. A pending-confirmation row (with SMTP configured the backend sends a confirmation
//      email and holds identity — invisible, and the owner will think it already happened)
//   3. Cancel (backing out also kills the link inside that confirmation email)
//
// The blurb has to state the consequences in full. It used to just say "Your login
// identity.", missing the second half.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { AcctBlock, PasswordField, SaveBtn } from '@/components/admin/sections/account/atoms';
import { emailHintMessage, emailSaveDisabled } from '@/lib/admin/account-form';
import type { AccountHook, EmailChangeResult } from '@/lib/admin/use-account';
import { useToast } from '@/lib/ui/toast';

interface EmailBlockProps {
  hook: AccountHook;
  initialValue: string;
  // pending — **passed in from session, not stored here.**
  //
  // The first version kept it in useState, so: save succeeds → hook calls
  // sessionStore.reset() → session goes back to loading → the parent skips rendering
  // this block until ready → EmailBlock unmounts and remounts → useState recomputes its
  // initial value (session hasn't come back yet, so it's empty) → the pending row
  // **doesn't appear**. The backend already wrote pending and sent the mail, but the
  // screen shows nothing.
  //
  // This is exactly "a fact belongs to whoever produces it; elsewhere only queries it,
  // never stores a copy": pending lives in the owners table, this component should only
  // display it. The moment you keep a second copy there are two truths, and they diverge
  // at the worst possible time.
  pending: string;
}

export function EmailBlock({ hook, initialValue, pending }: EmailBlockProps) {
  const t = useTranslations('adminShell.account');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState(initialValue);
  const [confirm, setConfirm] = useState('');
  const toast = useToast();
  const disabled = emailSaveDisabled(hook.pending, current, next, confirm, initialValue);
  const hintKey = emailHintMessage(next, confirm);
  const save = (): void => {
    void runSaveEmail(hook, { current, next }, { setCurrent, setConfirm }, toast,
      (saved) => saved.pending === ''
        ? t('emailUpdated', { email: saved.email })
        : t('emailConfirmSent', { pending: saved.pending }));
  };
  return (
    // The blurb states the consequences in full: the email column is both the login
    // identity and the recovery recipient, and both only move once (with mail) the new
    // address confirms. Kept accurate in-catalog ([[names-that-lie]]).
    <AcctBlock title={t('email')} testid="account-email-block" blurb={t('emailBlurb')}>
      <div>
        <PendingEmailRow
          pending={pending}
          onCancel={() => void runCancelEmail(hook, toast, t('emailCancelled'))}
        />
        <PasswordField
          testid="account-email-current-password"
          value={current} onChange={setCurrent} label={t('currentPassword')}
        />
        <EmailField
          testid="account-email-new" value={next} onChange={setNext}
          placeholder={t('emailPlaceholder')}
        />
        <div className="flex items-baseline gap-3 mt-3">
          <EmailField
            testid="account-email-confirm" value={confirm} onChange={setConfirm}
            placeholder={t('emailConfirmPlaceholder')}
          />
          <SaveBtn testid="account-email-save" disabled={disabled} label={t('saveEmail')}
            onClick={save} />
        </div>
        <FieldHint message={hintKey === '' ? '' : t(hintKey)} />
      </div>
    </AcctBlock>
  );
}

function EmailField(
  { testid, value, onChange, placeholder }:
  { testid: string; value: string; onChange: (v: string) => void; placeholder: string },
) {
  return (
    <input
      type="email" value={value} spellCheck={false} autoComplete="email"
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testid}
      className="sm-field-input sm-field-lg flex-1 min-w-0 mt-3"
    />
  );
}

function FieldHint({ message }: { message: string }) {
  return (
    <div className="mono text-[10px] text-(--color-accent) mt-1 min-h-[1em]">{message}</div>
  );
}

// PendingEmailRow — the pending-confirmation row. **An invisible pending state means the
// owner doesn't know whether the click they just made took effect**, so they'll think it
// finished and retire the old address.
function PendingEmailRow(
  { pending, onCancel }: { pending: string; onCancel: () => void },
) {
  const t = useTranslations('adminShell.account');
  return pending === '' ? null : (
    <div
      data-testid="account-email-pending"
      className="flex items-baseline justify-between gap-3 mb-3 p-2 border border-(--color-accent)/40 rounded-[3px]"
    >
      <span className="reading text-[12.5px] text-(--color-muted)">
        {t('pendingEmailNote', { pending })}
      </span>
      <SaveBtn
        testid="account-email-pending-cancel" disabled={false} label={t('cancel')}
        onClick={onCancel}
      />
    </div>
  );
}

interface EmailSaveSetters {
  setCurrent: (v: string) => void;
  setConfirm: (v: string) => void;
}

async function runSaveEmail(
  hook: AccountHook, input: { current: string; next: string },
  set: EmailSaveSetters, toast: { success: (m: string) => void },
  msg: (saved: EmailChangeResult) => string,
): Promise<void> {
  const saved = await hook.updateEmail(input.current, input.next);
  saved && finishEmailSave(set, toast, msg(saved));
}

// finishEmailSave — the two outcomes need two different messages (the caller picks which):
// "Email updated" is a lie when only a confirmation email went out, and the owner will
// retire the old address on the strength of that lie.
//
// Only clears the inputs, doesn't touch pending: that row's value comes from session, and
// the hook has already reset session.
function finishEmailSave(
  set: EmailSaveSetters,
  toast: { success: (m: string) => void },
  message: string,
): void {
  set.setCurrent('');
  set.setConfirm('');
  toast.success(message);
}

async function runCancelEmail(
  hook: AccountHook, toast: { success: (m: string) => void }, message: string,
): Promise<void> {
  const email = await hook.cancelEmailChange();
  email && toast.success(message);
}
