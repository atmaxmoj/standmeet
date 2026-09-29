// MasterModals —— the masters strip's two dialogs: name a master (new or rename) and confirm a
// delete. Same modal language as the drafts page (ModalShell + the discard-confirm card).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { ModalShell } from '@/components/admin/modals/ModalShell';

// NAME_MODAL —— the two uses differ only in words and test hooks.
const NAME_MODAL = {
  new: { title: 'newTitle', submit: 'create', input: 'new-master-name', button: 'new-master-create' },
  rename: { title: 'renameTitle', submit: 'save', input: 'master-rename-input', button: 'master-rename-save' },
} as const;

export function MasterNameModal({ kind, initial, onClose, onSubmit }: {
  kind: 'new' | 'rename'; initial: string; onClose: () => void; onSubmit: (name: string) => void;
}) {
  const t = useTranslations('adminJobs.masters');
  const [name, setName] = useState(initial);
  const v = NAME_MODAL[kind];
  const submit = (e: React.FormEvent): void => { e.preventDefault(); onSubmit(name); };
  return (
    <ModalShell onClose={onClose} kicker={t('newKicker')} title={t(v.title)}>
      <form onSubmit={submit} className="px-7 py-6 space-y-6">
        <label className="block">
          <span className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1.5 block">{t('nameLabel')}</span>
          <input
            data-testid={v.input}
            className="sm-field-input" value={name} autoFocus onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="flex items-center justify-end gap-3 border-t border-(--color-rule) pt-4">
          <button type="button" onClick={onClose} className="sm-btn sm-btn-ghost">{t('cancel')}</button>
          <button type="submit" disabled={name.trim() === ''} className="sm-btn sm-btn-solid" data-testid={v.button}>
            {t(v.submit)}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function DeleteMasterModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const t = useTranslations('adminJobs.masters');
  return (
    <div className="sm-fadein sm-composer-confirm-overlay" onClick={onCancel}>
      <div className="sm-composer-confirm-card sm-rise" onClick={(e) => e.stopPropagation()} data-testid="master-delete-modal">
        <div className="sm-smallcaps">{t('deleteTitle')}</div>
        <p className="sm-reading text-(--color-muted) text-[14.5px] mt-2">{t('deleteBody')}</p>
        <div className="flex items-center justify-end gap-3 mt-5">
          <button type="button" onClick={onCancel} className="sm-btn sm-btn-ghost">{t('cancel')}</button>
          <button type="button" onClick={onConfirm} className="sm-btn sm-btn-accent" data-testid="master-delete-confirm">{t('delete')}</button>
        </div>
      </div>
    </div>
  );
}
