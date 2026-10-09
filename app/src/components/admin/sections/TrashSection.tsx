// TrashSection —— /admin/trash. Every delete of an owner asset lands here for 90 days (the server
// purges it after): corpus entries (restored with the descendants deleted with them and their
// links), résumé masters, microsites (restored with their builds and store) and asset pool files
// (restored with their blob).

'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { ListPane } from '@/components/admin/ListPane';
import { SectionHeader } from '@/components/admin/SectionHeader';
import styles from '@/components/admin/sections/TrashSection.module.css';
import {
  trashDate, useAssetsTrash, useMastersTrash, useMicrositesTrash, useTrash, type TrashItem,
} from '@/lib/admin/use-trash';
import { useEffectErrorToast, useToast } from '@/lib/ui/toast';

export function TrashSection() {
  const t = useTranslations('adminCorpus.trash');
  const tp = useTranslations('adminCorpus.posts');
  const hook = useTrash();
  const masters = useMastersTrash();
  const sites = useMicrositesTrash();
  const files = useAssetsTrash();
  const all = [hook, masters, sites, files];
  const { refresh } = hook;
  const refreshMasters = masters.refresh;
  const refreshSites = sites.refresh;
  const refreshFiles = files.refresh;
  // Always re-read on entry: deletes happen in other sections (and over MCP).
  useEffect(() => {
    void refresh(); void refreshMasters(); void refreshSites(); void refreshFiles();
  }, [refresh, refreshMasters, refreshSites, refreshFiles]);
  useEffectErrorToast(firstError(all));
  const count = all.reduce((n, g) => n + g.items.length, 0);
  // Posts come back from the corpus trash like any genre, but have no title or tree: they read as
  // their own group, each named by its text.
  const notes = hook.items.filter((i) => i.genre !== 'post');
  const posts = hook.items.filter((i) => i.genre === 'post').map((i) => ({ ...i, name: i.title }));
  return (
    <>
      <SectionHeader kicker={t('kicker')} slug="trash" />
      <p className={`reading ${styles.intro}`}>{t('intro')}</p>
      {/* Empty only when every trash is: "the trash is empty" over a trashed page would lie. */}
      <ListPane
        status={hook.status} count={count}
        empty={<p className="sm-empty-hint reading" data-testid="trash-empty">{t('empty')}</p>}
      >
        <div className={styles.list}>
          {notes.map((item) => <TrashRow key={item.id} item={item} restore={hook.restore} />)}
        </div>
        <NamedGroup kind="post" label={tp('trashGroup')} items={posts} restore={hook.restore} />
        <NamedGroup kind="master" label={t('masters')} items={masters.items} restore={masters.restore} />
        <NamedGroup
          kind="microsite" label={t('microsites')} restore={sites.restore}
          items={sites.items.map((p) => ({ ...p, name: `/p/${p.slug}` }))}
        />
        <NamedGroup kind="asset" label={t('assets')} items={files.items} restore={files.restore} />
      </ListPane>
    </>
  );
}

// firstError —— the first trash that failed to load, if any.
function firstError(groups: readonly { error: string | null }[]): string | null {
  return groups.find((g) => g.error !== null)?.error ?? null;
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

// NamedTrash —— a trashed thing that is just a name: a résumé master, a microsite.
interface NamedTrash { id: string; name: string; deleted_at: string; purge_at: string }

function NamedGroup({ kind, label, items, restore }: {
  kind: string; label: string; items: readonly NamedTrash[]; restore: (id: string) => Promise<void>;
}) {
  return items.length > 0 && (
    <section className={styles.group} data-testid={`trash-${kind}s`}>
      <div className="sm-smallcaps">{label}</div>
      <div className={styles.list}>
        {items.map((it) => <NamedRow key={it.id} kind={kind} item={it} restore={restore} />)}
      </div>
    </section>
  );
}

function NamedRow({ kind, item, restore }: {
  kind: string; item: NamedTrash; restore: (id: string) => Promise<void>;
}) {
  const t = useTranslations('adminCorpus.trash');
  const onRestore = useRestore(item.name, () => restore(item.id));
  return (
    <div className={styles.row} data-testid={`trash-${kind}-row-${item.id}`}>
      <span className={styles.title}>{item.name}</span>
      <Dates deletedAt={item.deleted_at} purgeAt={item.purge_at} />
      <button
        type="button" className="sm-btn sm-btn-sm" onClick={onRestore}
        data-testid={`trash-${kind}-restore-${item.id}`}
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
