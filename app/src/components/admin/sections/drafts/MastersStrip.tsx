// MastersStrip —— the top of /admin/drafts: the owner's résumé masters (named, persistent résumés;
// docs/design/resume-masters.md). A card shows the thumbnail, the name, the default badge, when it
// was updated and which draft it came from, and its actions: edit (the master editor), new draft
// from it, rename, make default, delete. "+ new master" starts a blank one. Paged through the one
// paginator (docs/design/paging.md).

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { LoadMore } from '@/components/admin/LoadMore';
import { DraftThumb } from '@/components/admin/sections/drafts/DraftThumb';
import { DeleteMasterModal, MasterNameModal } from '@/components/admin/sections/drafts/MasterModals';
import {
  createMaster, deleteMaster, mastersPage, renameMaster, setDefaultMaster, type MasterView,
} from '@/lib/admin/use-resume-masters';
import { usePaged } from '@/lib/state/create-paged-store';
import { useAction } from '@/lib/ui/use-action';
import { stampDay } from '@/lib/ui/format-time';

// Dialog —— which modal is open: a new master, a rename, or a delete confirm (null = none).
type Dialog = { kind: 'new' } | { kind: 'rename' | 'delete'; master: MasterView } | null;

export function MastersStrip({ onNewDraft }: { onNewDraft: (masterId: string) => void }) {
  const t = useTranslations('adminJobs.masters');
  const page = usePaged(mastersPage);
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <section data-testid="masters-strip" className="mb-10">
      <AdminSectionHead aside={<span data-testid="masters-total">{page.total ?? ''}</span>}>
        {t('heading')}
      </AdminSectionHead>
      <p className="reading-tight text-(--color-muted) mb-4 text-[14px] max-w-[54em]">{t('hint')}</p>
      <ListPane status={page.status} count={page.items.length} empty={<MastersEmpty />}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {page.items.map((m) => (
            <MasterCard key={m.id} master={m} onNewDraft={onNewDraft} onDialog={setDialog} />
          ))}
        </div>
      </ListPane>
      <LoadMore page={page} testid="masters-load-more" />
      <NewMasterBtn onOpen={() => setDialog({ kind: 'new' })} />
      <StripDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}

function MastersEmpty() {
  const t = useTranslations('adminJobs.masters');
  return (
    <div className="sm-empty" data-testid="masters-empty">
      <p className="sm-empty-title">{t('emptyTitle')}</p>
      <p className="sm-empty-hint reading">{t('emptyHint')}</p>
    </div>
  );
}

function NewMasterBtn({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('adminJobs.masters');
  return (
    <button type="button" onClick={onOpen} data-testid="master-new" className="sm-btn sm-btn-outline sm-btn-sm mt-4">
      {t('new')}
    </button>
  );
}

function MasterCard({ master, onNewDraft, onDialog }: {
  master: MasterView; onNewDraft: (id: string) => void; onDialog: (d: Dialog) => void;
}) {
  const t = useTranslations('adminJobs.masters');
  const router = useRouter();
  return (
    <article data-testid="master-card" className="border border-(--color-rule) rounded-[3px] p-4 hover:border-(--color-ink) transition-colors grid grid-cols-[1fr_184px] gap-4">
      <div className="flex flex-col gap-2 min-w-0">
        <MasterCardHead master={master} />
        <MasterMeta master={master} />
        <div className="flex items-baseline gap-3 flex-wrap mt-auto">
          <button type="button" data-testid="master-edit" onClick={() => router.push(`/admin/edit-master/${master.id}`)} className="sm-btn sm-btn-outline sm-btn-sm">{t('edit')}</button>
          <button type="button" data-testid="master-new-draft" onClick={() => onNewDraft(master.id)} className="sm-btn sm-btn-solid sm-btn-sm">{t('newDraft')}</button>
        </div>
        <MasterMinorActions master={master} onDialog={onDialog} />
      </div>
      <DraftThumb row={master} />
    </article>
  );
}

function MasterCardHead({ master }: { master: MasterView }) {
  const t = useTranslations('adminJobs.drafts');
  return (
    <header className="flex items-baseline gap-2 flex-wrap">
      <h3 data-testid="master-name" className="font-serif text-[18px] text-(--color-ink) font-medium tracking-[-0.005em]">{master.name}</h3>
      {master.is_default && <span data-testid="master-default-badge" className="sm-pill is-accent">{t('defaultBadge')}</span>}
    </header>
  );
}

function MasterMeta({ master }: { master: MasterView }) {
  const t = useTranslations('adminJobs.masters');
  const date = stampDay(master.updated_at);
  return (
    <p data-testid="master-meta" className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted)">
      {master.from_company === '' ? t('metaUpdated', { date }) : t('metaFrom', { date, company: master.from_company })}
    </p>
  );
}

const MINOR = 'mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint) hover:text-(--color-accent) bg-transparent';

function MasterMinorActions({ master, onDialog }: { master: MasterView; onDialog: (d: Dialog) => void }) {
  const t = useTranslations('adminJobs.masters');
  const run = useAction();
  return (
    <div className="flex items-baseline gap-3">
      <button type="button" data-testid="master-rename" className={MINOR} onClick={() => onDialog({ kind: 'rename', master })}>{t('rename')}</button>
      {!master.is_default && (
        <button type="button" data-testid="master-set-default" className={MINOR} onClick={() => void run(() => setDefaultMaster(master.id), { success: t('defaulted') })}>
          {t('setDefault')}
        </button>
      )}
      <button type="button" data-testid="master-delete" className={MINOR} onClick={() => onDialog({ kind: 'delete', master })}>{t('delete')}</button>
    </div>
  );
}

// StripDialogs —— the one open modal, if any. Each closes itself on success.
function StripDialogs({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const t = useTranslations('adminJobs.masters');
  const router = useRouter();
  const run = useAction();
  const create = (name: string): void => {
    void run(async () => {
      const m = await createMaster(name);
      onClose();
      router.push(`/admin/edit-master/${m.id}`);
    }, { success: t('created') });
  };
  const map = {
    new: () => <MasterNameModal kind="new" initial="" onClose={onClose} onSubmit={create} />,
    rename: (m: MasterView) => (
      <MasterNameModal
        kind="rename" initial={m.name} onClose={onClose}
        onSubmit={(name) => void run(async () => { await renameMaster(m.id, name); onClose(); }, { success: t('renamed') })}
      />
    ),
    delete: (m: MasterView) => (
      <DeleteMasterModal
        onCancel={onClose}
        onConfirm={() => void run(async () => { onClose(); await deleteMaster(m.id); }, { success: t('deleted') })}
      />
    ),
  };
  return dialog === null ? null : dialog.kind === 'new' ? map.new() : map[dialog.kind](dialog.master);
}
