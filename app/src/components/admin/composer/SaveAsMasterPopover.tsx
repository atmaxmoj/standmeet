// SaveAsMasterPopover —— the composer's "set as master ▾" (docs/design/resume-masters.md): keep this
// draft's résumé as a master — overwrite the master it came from (the pre-selected choice when there
// is one), or save it as a new master with a name, optionally the default. Only resume_content is
// copied; the draft is unchanged and keeps its expiry. The current edit is saved first, so the master
// gets what is on screen.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import type { DraftContext } from '@/lib/admin/draft-detail';
import { saveDraftAsMaster } from '@/lib/admin/use-resume-masters';
import { useAction } from '@/lib/ui/use-action';

export function SaveAsMasterPopover({ draftId, context, beforeSave, onClose }: {
  draftId: string; context: DraftContext; beforeSave: () => Promise<void>; onClose: () => void;
}) {
  const t = useTranslations('adminJobs.masters');
  const run = useAction();
  const [overwrite, setOverwrite] = useState(context.basedOnId !== '');
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const save = (): void => {
    void run(async () => {
      await beforeSave();
      await saveDraftAsMaster(draftId, overwrite
        ? { mode: 'overwrite', masterId: context.basedOnId }
        : { mode: 'new', name, makeDefault });
      onClose();
    }, { success: t('savedAsMaster') });
  };
  return (
    <div role="dialog" aria-label={t('saveAsMasterTitle')} data-testid="save-as-master-popover" className="absolute right-4 top-16 sm-z-float-1 w-[380px] border border-(--color-rule) bg-(--color-paper) rounded-[3px] p-5 space-y-4 shadow-lg">
      <div className="font-serif text-[18px] text-(--color-ink)">{t('saveAsMasterTitle')}</div>
      <p className="sm-reading text-(--color-muted) text-[14px]">{t('saveAsMasterBody')}</p>
      {context.basedOnId !== '' && (
        <label className="flex gap-2.5 items-start text-[15px]">
          <input type="radio" name="as-master" data-testid="save-master-overwrite" checked={overwrite} onChange={() => setOverwrite(true)} className="mt-1" />
          <span>
            {t('overwrite', { name: context.basedOnName })}
            <span className="block mono text-[11px] text-(--color-muted)">{t('overwriteHint')}</span>
          </span>
        </label>
      )}
      <label className="flex gap-2.5 items-center text-[15px]">
        <input type="radio" name="as-master" data-testid="save-master-new" checked={!overwrite} onChange={() => setOverwrite(false)} />
        <span>{t('saveAsNew')}</span>
      </label>
      <NewMasterFields
        disabled={overwrite} name={name} onName={setName} makeDefault={makeDefault} onDefault={setMakeDefault}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="sm-btn sm-btn-ghost sm-btn-sm" data-testid="save-master-cancel">{t('cancel')}</button>
        <button type="button" onClick={save} disabled={!overwrite && name.trim() === ''} className="sm-btn sm-btn-solid sm-btn-sm" data-testid="save-master-confirm">
          {t('saveConfirm')}
        </button>
      </div>
    </div>
  );
}

function NewMasterFields({ disabled, name, onName, makeDefault, onDefault }: {
  disabled: boolean; name: string; onName: (v: string) => void; makeDefault: boolean; onDefault: (v: boolean) => void;
}) {
  const t = useTranslations('adminJobs.masters');
  return (
    <fieldset disabled={disabled} className="pl-6 space-y-3 disabled:opacity-50">
      <label className="block">
        <span className="mono text-[10px] tracking-[0.2em] uppercase text-(--color-muted) mb-1.5 block">{t('nameLabel')}</span>
        <input data-testid="save-master-name" className="sm-field-input" value={name} onChange={(e) => onName(e.target.value)} />
      </label>
      <label className="flex gap-2.5 items-center text-[14px] text-(--color-muted)">
        <input type="checkbox" data-testid="save-master-default" checked={makeDefault} onChange={(e) => onDefault(e.target.checked)} />
        <span>{t('makeDefault')}</span>
      </label>
    </fieldset>
  );
}
