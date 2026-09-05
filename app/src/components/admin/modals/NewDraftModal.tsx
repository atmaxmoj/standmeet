// NewDraftModal — the owner starts a resume draft by hand (company + role).
// Claude usually creates drafts along the job-loop path; this is the panel-side
// entry the owner asked for. On save the server carries their most recent resume
// content into the new draft, which then opens in the composer like any other.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { ModalShell } from '@/components/admin/modals/ModalShell';
import { Btn } from '@/components/admin/atoms/Btn';
import { createManualDraft } from '@/lib/admin/create-draft';
import { useAction } from '@/lib/ui/use-action';

type Props = { onClose: () => void; onCreated: () => void };

export function NewDraftModal({ onClose, onCreated }: Props) {
  const t = useTranslations('adminJobs');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const run = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      async () => { await createManualDraft({ company, role }); onCreated(); },
      { success: 'Draft created' },
    );
  };
  return (
    <ModalShell onClose={onClose} kicker={t('drafts.newKicker')} title={t('drafts.newTitle')}>
      <form data-testid="new-draft-form" onSubmit={submit} className="px-7 py-6 space-y-6">
        <Field
          label={t('drafts.newCompany')} testid="new-draft-company"
          value={company} onChange={setCompany} autoFocus
        />
        <Field
          label={t('drafts.newRole')} testid="new-draft-role"
          value={role} onChange={setRole}
        />
        <Footer disabled={company.trim() === ''} onClose={onClose} label={t('drafts.newCreate')} />
      </form>
    </ModalShell>
  );
}

function Field({
  label, testid, value, onChange, autoFocus,
}: {
  label: string; testid: string; value: string;
  onChange: (v: string) => void; autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1.5 block">
        {label}
      </span>
      <input
        data-testid={testid}
        className="sm-field-input"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Footer({
  disabled, onClose, label,
}: { disabled: boolean; onClose: () => void; label: string }) {
  const t = useTranslations('adminShell.codeModal');
  return (
    <div className="flex items-center justify-end gap-3 border-t border-(--color-rule) pt-4">
      <Btn kind="ghost" onClick={onClose}>{t('cancel')}</Btn>
      <button
        type="submit"
        data-testid="new-draft-create"
        disabled={disabled}
        className="mono text-[11px] tracking-[0.14em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-40"
      >
        {label}
      </button>
    </div>
  );
}
