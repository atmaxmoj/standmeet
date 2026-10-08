// TrashSection —— /admin/trash. Every delete of an owner asset lands here for 90 days (the server
// purges it after): corpus entries (restored with the descendants deleted with them and their
// links) and résumé masters.

'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { ListPane } from '@/components/admin/ListPane';
import { SectionHeader } from '@/components/admin/SectionHeader';
import styles from '@/components/admin/sections/TrashSection.module.css';
import {
  trashDate, useMastersTrash, useTrash, type TrashedMaster, type TrashItem,
} from '@/lib/admin/use-trash';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function TrashSection() {
  const t = useTranslations('adminCorpus.trash');
  const hook = useTrash();
  const masters = useMastersTrash();
  const { refresh } = hook;
  const refreshMasters = masters.refresh;
  // Always re-read on entry: deletes happen in other sections (and over MCP).
  useEffect(() => { void refresh(); void refreshMasters(); }, [refresh, refreshMasters]);
  useEffectErrorToast(hook.error ?? masters.error);
  return (
    <>
      <SectionHeader kicker={t('kicker')} slug="trash" />
      <p className={`reading ${styles.intro}`}>{t('intro')}</p>
      {/* Empty only when both trashes are: "the trash is empty" over a trashed master would lie. */}
      <ListPane
        status={hook.status} count={hook.items.length + masters.items.length}
        empty={<p className="sm-empty-hint reading" data-testid="trash-empty">{t('empty')}</p>}
      >
        <div className={styles.list}>
          {hook.items.map((item) => <TrashRow key={item.id} item={item} restore={hook.restore} />)}
        </div>
        {masters.items.length > 0 && (
          <section className={styles.group} data-testid="trash-masters">
            <div className="sm-smallcaps">{t('masters')}</div>
            <div className={styles.list}>
              {masters.items.map((m) => <MasterRow key={m.id} item={m} restore={masters.restore} />)}
            </div>
          </section>
        )}
      </ListPane>
    </>
  );
}

// useRestore —— runs a restore and says how it went.
function useRestore(title: string, restore: () => Promise<void>): () => void {
  const t = useTranslations('adminCorpus.trash');
  const toast = useToast();
  return () => {
    restore().then(
      () => toast.success(t('restored', { title })),
      (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
    );
  };
}

function TrashRow({ item, restore }: { item: TrashItem; restore: (id: string) => Promise<void> }) {
  const t = useTranslations('adminCorpus.trash');
  const onRestore = useRestore(item.title, () => restore(item.id));
  return (
    <div className={styles.row} data-testid={`trash-row-${item.id}`}>
      <span className={styles.meta}>{item.genre}</span>
      <span className={styles.title}>{item.title}</span>
      {item.descendants > 0 && (
        <span className={styles.meta}>{t('withChildren', { n: item.descendants })}</span>
      )}
      <Dates deletedAt={item.deleted_at} purgeAt={item.purge_at} />
      <button
        type="button" className="sm-btn sm-btn-sm" onClick={onRestore}
        data-testid={`trash-restore-${item.id}`}
      >
        {t('restore')}
      </button>
    </div>
  );
}

function MasterRow({ item, restore }: { item: TrashedMaster; restore: (id: string) => Promise<void> }) {
  const t = useTranslations('adminCorpus.trash');
  const onRestore = useRestore(item.name, () => restore(item.id));
  return (
    <div className={styles.row} data-testid={`trash-master-row-${item.id}`}>
      <span className={styles.title}>{item.name}</span>
      <Dates deletedAt={item.deleted_at} purgeAt={item.purge_at} />
      <button
        type="button" className="sm-btn sm-btn-sm" onClick={onRestore}
        data-testid={`trash-master-restore-${item.id}`}
      >
        {t('restore')}
      </button>
    </div>
  );
}

function Dates({ deletedAt, purgeAt }: { deletedAt: string; purgeAt: string }) {
  const t = useTranslations('adminCorpus.trash');
  return (
    <>
      <span className={styles.meta}>{t('deletedOn', { date: trashDate(deletedAt) })}</span>
      <span className={styles.meta}>{t('purgeOn', { date: trashDate(purgeAt) })}</span>
    </>
  );
}
