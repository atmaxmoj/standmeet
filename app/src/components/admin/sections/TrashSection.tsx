// TrashSection —— /admin/trash. Every corpus delete lands here for 90 days (the server purges it
// after); restore puts the entry back with the descendants deleted with it and its links.

'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { ListPane } from '@/components/admin/ListPane';
import { SectionHeader } from '@/components/admin/SectionHeader';
import styles from '@/components/admin/sections/TrashSection.module.css';
import { trashDate, useTrash, type TrashItem } from '@/lib/admin/use-trash';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function TrashSection() {
  const t = useTranslations('adminCorpus.trash');
  const hook = useTrash();
  const { refresh } = hook;
  // Always re-read on entry: deletes happen in other sections (and over MCP).
  useEffect(() => { void refresh(); }, [refresh]);
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader kicker={t('kicker')} slug="trash" />
      <p className={`reading ${styles.intro}`}>{t('intro')}</p>
      <ListPane
        status={hook.status} count={hook.items.length}
        empty={<p className="sm-empty-hint reading" data-testid="trash-empty">{t('empty')}</p>}
      >
        <div className={styles.list}>
          {hook.items.map((item) => <TrashRow key={item.id} item={item} restore={hook.restore} />)}
        </div>
      </ListPane>
    </>
  );
}

function TrashRow({ item, restore }: { item: TrashItem; restore: (id: string) => Promise<void> }) {
  const t = useTranslations('adminCorpus.trash');
  const toast = useToast();
  const onRestore = () => {
    restore(item.id).then(
      () => toast.success(t('restored', { title: item.title })),
      (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
    );
  };
  return (
    <div className={styles.row} data-testid={`trash-row-${item.id}`}>
      <span className={styles.meta}>{item.genre}</span>
      <span className={styles.title}>{item.title}</span>
      {item.descendants > 0 && (
        <span className={styles.meta}>{t('withChildren', { n: item.descendants })}</span>
      )}
      <span className={styles.meta}>{t('deletedOn', { date: trashDate(item.deleted_at) })}</span>
      <span className={styles.meta}>{t('purgeOn', { date: trashDate(item.purge_at) })}</span>
      <button
        type="button" className="sm-btn sm-btn-sm" onClick={onRestore}
        data-testid={`trash-restore-${item.id}`}
      >
        {t('restore')}
      </button>
    </div>
  );
}
