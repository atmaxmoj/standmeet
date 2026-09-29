// MasterComposer —— the master editor (docs/design/resume-masters.md): the same Puck composer in
// master mode. A banner says it is not tied to a job; there is no SEND and no code picker (a master
// has no job and no code); Save writes the master; "new draft from it" opens the new-draft flow on it
// and goes to the new draft's composer.

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { DiscardModal, SaveButton, useComposerEdits } from '@/components/admin/composer/PuckComposer';
import { PuckResumeEditor } from '@/components/admin/composer/PuckResumeEditor';
import { NewDraftModal } from '@/components/admin/modals/NewDraftModal';
import { ComposerCodeContext, MASTER_CODE_CONTROL } from '@/lib/admin/composer-code-context';
import { masterModel, masterPreviewURL, saveMasterContent, type MasterView } from '@/lib/admin/use-resume-masters';

export function MasterComposer({ master }: { master: MasterView }) {
  const router = useRouter();
  const [model] = useState(() => masterModel(master));
  const edits = useComposerEdits(model, saveMasterContent);
  const [newDraft, setNewDraft] = useState(false);
  return (
    <div className="relative flex flex-col h-[calc(100vh-3.5rem)]" data-testid="puck-composer">
      <MasterBar master={master} dirty={edits.dirty} onBack={edits.back} onSave={edits.save} onNewDraft={() => setNewDraft(true)} />
      <MasterBanner />
      <ComposerCodeContext.Provider value={MASTER_CODE_CONTROL}>
        <div className="flex-1 min-h-0">
          <PuckResumeEditor initial={edits.initial} onData={edits.onData} />
        </div>
      </ComposerCodeContext.Provider>
      {newDraft && (
        <NewDraftModal
          preselect={master.id} onClose={() => setNewDraft(false)}
          onCreated={(d) => router.push(`/admin/edit-resume/${d.id}`)}
        />
      )}
      {edits.discard && (
        <DiscardModal onKeep={() => edits.setDiscard(false)} onDiscard={() => { edits.setDiscard(false); edits.leave(); }} />
      )}
    </div>
  );
}

function MasterBar({ master, dirty, onBack, onSave, onNewDraft }: {
  master: MasterView; dirty: boolean; onBack: () => void; onSave: () => void; onNewDraft: () => void;
}) {
  const t = useTranslations('adminShell.composer');
  const tm = useTranslations('adminJobs.masters');
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-(--color-rule)">
      <div className="flex items-center gap-3 min-w-0">
        <button type="button" onClick={onBack} className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) bg-transparent" data-testid="composer-back">
          {t('backToDrafts')}
        </button>
        <span className="sm-pill is-accent">{tm('badge')}</span>
        <span className="font-serif text-[18px] text-(--color-ink) truncate" data-testid="master-editor-name">{master.name}</span>
        <span className="mono text-[11px] text-(--color-muted)">{master.is_default ? tm('metaNeverDefault') : tm('metaNever')}</span>
      </div>
      <div className="flex items-center gap-3">
        <a href={masterPreviewURL(master.id, Date.now())} target="_blank" rel="noreferrer" className="mono text-[11px] tracking-[0.06em] text-(--color-muted) hover:text-(--color-ink)" data-testid="composer-preview">
          {t('previewPdf')}
        </a>
        <SaveButton dirty={dirty} onSave={onSave} />
        <button type="button" onClick={onNewDraft} className="sm-btn sm-btn-solid sm-btn-sm" data-testid="master-new-draft">
          {tm('newDraft')}
        </button>
      </div>
    </header>
  );
}

function MasterBanner() {
  const tm = useTranslations('adminJobs.masters');
  return (
    <p data-testid="master-editor-banner" className="px-4 py-2 border-b border-(--color-rule) text-[14px] text-(--color-muted) sm-reading">
      {tm('banner')}
    </p>
  );
}
