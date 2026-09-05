// DataSection —— /admin/data. Manage the per-microsite data stores: each microsite has its own
// NoSQL namespace visitors can write into (a poll tally, a sign-up sheet). This is where the owner
// inspects what a page has collected and deletes documents or clears a store.
//
// The store's write gate + isolation live in the backend; this section is the management view.
// A microsite with no store yet simply shows as empty — reads tolerate a not-yet-provisioned
// schema (the first visitor write creates it).

'use client';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  pickMicrositesBodyState,
  useMicrosites,
  type MicrositesHook,
  type MicrositeSummary,
} from '@/lib/admin/use-microsites';
import { useMicrositeStore, type StoreDoc } from '@/lib/admin/use-microsite-store';
import { useAction } from '@/lib/ui/use-action';

export function DataSection() {
  const hook = useMicrosites();
  return (
    <>
      <SectionHeader
        kicker="resources · data"
        slug="data"
        count={hook.rows.length > 0 ? String(hook.rows.length) : ''}
      />
      <Intro />
      <Body hook={hook} />
    </>
  );
}

function Intro() {
  const t = useTranslations('adminPages.data');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t('intro')}
    </p>
  );
}

function Body({ hook }: { hook: MicrositesHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <StoreList rows={hook.rows} />,
  } as const;
  return map[pickMicrositesBodyState(hook)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="data-error">
      {message}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminPages.data');
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8" data-testid="data-empty">
      {t('empty')}
    </p>
  );
}

function StoreList({ rows }: { rows: readonly MicrositeSummary[] }) {
  return (
    <div data-testid="data-list" className="flex flex-col gap-2">
      {rows.map((p) => <StoreRow key={p.id} page={p} />)}
    </div>
  );
}

// StoreRow —— one microsite, collapsed to its title. Opening it fetches that page's store on
// demand (no store is loaded until asked — a page's docs aren't in the microsites list).
function StoreRow({ page }: { page: MicrositeSummary }) {
  const t = useTranslations('adminPages.data');
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-(--color-rule) rounded-[3px]">
      <button
        type="button"
        data-testid={`data-open-${page.slug}`}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-baseline justify-between gap-3 px-4 py-3 text-left hover:bg-(--color-surface)/40"
      >
        <span className="font-serif text-[16px] text-(--color-ink)">{page.title}</span>
        <span className="mono text-[10px] text-(--color-faint)">{t('slugPath', { slug: page.slug })}</span>
      </button>
      {open ? <StoreView slug={page.slug} /> : null}
    </div>
  );
}

function StoreView({ slug }: { slug: string }) {
  const store = useMicrositeStore(slug);
  const map = {
    loading: <Loading />,
    error: <StoreError />,
    empty: <StoreEmpty />,
    list: <DocList slug={slug} store={store} />,
  } as const;
  return (
    <div className="border-t border-(--color-rule) px-4 py-3" data-testid={`data-store-${slug}`}>
      {map[pickStoreState(store)]}
    </div>
  );
}

type Store = ReturnType<typeof useMicrositeStore>;

// NOT_READY maps a non-ready status to a body state; 'ready' is handled separately (by count).
const NOT_READY = { idle: 'loading', loading: 'loading', error: 'error' } as const;

function pickStoreState(store: Store): 'loading' | 'error' | 'empty' | 'list' {
  return store.status === 'ready'
    ? (store.docs.length === 0 ? 'empty' : 'list')
    : NOT_READY[store.status];
}

function Loading() {
  return <ListSkeleton count={2} />;
}

function StoreError() {
  const t = useTranslations('adminPages.data');
  return <p className="mono text-[11px] text-(--color-accent)">{t('storeError')}</p>;
}

function StoreEmpty() {
  const t = useTranslations('adminPages.data');
  return <p className="reading-tight italic text-(--color-muted)">{t('storeEmpty')}</p>;
}

function DocList({ slug, store }: { slug: string; store: Store }) {
  return (
    <div className="flex flex-col gap-2">
      <ClearButton slug={slug} store={store} />
      {store.docs.map((d) => <DocRow key={d.id} doc={d} store={store} />)}
    </div>
  );
}

function ClearButton({ slug, store }: { slug: string; store: Store }) {
  const t = useTranslations('adminPages.data');
  const run = useAction();
  return (
    <div className="flex justify-end">
      <button
        type="button"
        data-testid={`data-clear-${slug}`}
        onClick={() => void run(() => store.clear().then(store.reload), { success: t('cleared') })}
        className="mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      >
        {t('clear')}
      </button>
    </div>
  );
}

function DocRow({ doc, store }: { doc: StoreDoc; store: Store }) {
  return (
    <div
      data-testid={`data-doc-${doc.id}`}
      className="flex items-start justify-between gap-3 border border-(--color-rule)/60 rounded-[3px] px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        <span className="mono text-[9.5px] tracking-[0.14em] uppercase text-(--color-faint)">
          {doc.collection}
        </span>
        <pre className="mono text-[11px] text-(--color-ink) whitespace-pre-wrap break-words mt-1 overflow-x-auto">
          {JSON.stringify(doc.doc)}
        </pre>
      </div>
      <DeleteDocButton doc={doc} store={store} />
    </div>
  );
}

function DeleteDocButton({ doc, store }: { doc: StoreDoc; store: Store }) {
  const t = useTranslations('adminPages.data');
  const run = useAction();
  return (
    <button
      type="button"
      data-testid={`data-doc-delete-${doc.id}`}
      onClick={() =>
        void run(() => store.deleteDoc(doc.collection, doc.id).then(store.reload), {
          success: t('docDeleted'),
        })
      }
      className="shrink-0 mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
    >
      {t('delete')}
    </button>
  );
}
