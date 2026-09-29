// NewDraftModal — the owner starts a resume draft by hand (company + role) and picks where it
// starts from ("从哪份开始"): one of the masters (the default pre-selected, or the master the modal
// was opened on) or blank. The draft is a copy — editing it never touches the master.
// docs/design/resume-masters.md.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { ModalShell } from '@/components/admin/modals/ModalShell';
import { LoadMore } from '@/components/admin/LoadMore';
import { resolveBtnClass } from '@/lib/admin/btn-styles';
import { createManualDraft, type CreatedDraft } from '@/lib/admin/create-draft';
import { BLANK, mastersPage, startChoice, type MasterView } from '@/lib/admin/use-resume-masters';
import { usePaged } from '@/lib/state/create-paged-store';
import { useAction } from '@/lib/ui/use-action';

type Props = { onClose: () => void; onCreated: (d: CreatedDraft) => void; preselect?: string };

export function NewDraftModal({ onClose, onCreated, preselect = '' }: Props) {
  const t = useTranslations('adminJobs');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const masters = usePaged(mastersPage);
  const start = startChoice(picked, preselect, masters.items);
  const run = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      async () => { onCreated(await createManualDraft({ company, role, start })); },
      { success: t('drafts.created') },
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
        <StartPicker masters={masters.items} start={start} onPick={setPicked} />
        <LoadMore page={masters} testid="new-draft-masters-more" />
        <Footer disabled={company.trim() === ''} onClose={onClose} label={t('drafts.newCreate')} />
      </form>
    </ModalShell>
  );
}

// StartPicker —— one radio per master, then blank.
function StartPicker({ masters, start, onPick }: {
  masters: readonly MasterView[]; start: string; onPick: (id: string) => void;
}) {
  const t = useTranslations('adminJobs.drafts');
  return (
    <fieldset className="space-y-2">
      <legend className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1.5">{t('newFrom')}</legend>
      {masters.map((m) => (
        <StartOption key={m.id} id={m.id} checked={start === m.id} onPick={onPick}>
          {t('newFromMaster', { name: m.name })}
          {m.is_default && <span className="sm-pill is-accent ml-2">{t('defaultBadge')}</span>}
        </StartOption>
      ))}
      <StartOption id={BLANK} checked={start === BLANK} onPick={onPick}>{t('newFromBlank')}</StartOption>
      <p className="sm-reading text-(--color-muted) text-[13.5px]">{t('newFromHint')}</p>
    </fieldset>
  );
}

function StartOption({ id, checked, onPick, children }: {
  id: string; checked: boolean; onPick: (id: string) => void; children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 border border-(--color-rule) rounded-[2px] px-3 py-2 cursor-pointer has-[:checked]:border-(--color-accent)">
      <input
        type="radio" name="draft-start" data-testid={`new-draft-master-${id}`}
        checked={checked} onChange={() => onPick(id)}
      />
      <span className="font-serif text-[15px] text-(--color-ink)">{children}</span>
    </label>
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
      <button type="button" onClick={onClose} className={resolveBtnClass('ghost')} data-testid="new-draft-cancel">{t('cancel')}</button>
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
