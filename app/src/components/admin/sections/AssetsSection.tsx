// AssetsSection —— /admin/assets. The global asset pool: every image / file the owner
// has uploaded, owner-owned and shared across corpus entries and microsites.
//
// Delete is guarded server-side: an asset still cited by a corpus entry or a microsite
// refuses to delete (409) and the backend's message names who references it. That message
// is what the delete's error toast shows — the owner deletes the referrer first, then the
// asset. Uploading into the pool + citing an asset happen elsewhere (corpus slash command,
// microsite asset widget); this section is the pool's viewer + the guarded delete.

'use client';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { isImage, sizeLabel, useAssets, type PoolAsset } from '@/lib/admin/use-assets';
import { useAction } from '@/lib/ui/use-action';

export function AssetsSection() {
  const t = useTranslations('adminPages.assets');
  const hook = useAssets();
  return (
    <>
      <SectionHeader
        kicker={t('kicker')}
        slug="assets"
        count={hook.assets.length > 0 ? String(hook.assets.length) : ''}
      />
      <Intro />
      <Body hook={hook} />
    </>
  );
}

function Intro() {
  const t = useTranslations('adminPages.assets');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t('intro')}
    </p>
  );
}

type Hook = ReturnType<typeof useAssets>;

function Body({ hook }: { hook: Hook }) {
  const map = {
    loading: <ListSkeleton count={4} />,
    error: <ErrorBlock />,
    empty: <EmptyState />,
    list: <AssetGrid hook={hook} />,
  } as const;
  return map[pickState(hook)];
}

// NOT_READY maps a non-ready status to a body state; 'ready' is handled separately (by count).
const NOT_READY = { idle: 'loading', loading: 'loading', error: 'error' } as const;

function pickState(hook: Hook): 'loading' | 'error' | 'empty' | 'list' {
  return hook.status === 'ready'
    ? (hook.assets.length === 0 ? 'empty' : 'list')
    : NOT_READY[hook.status];
}

function ErrorBlock() {
  const t = useTranslations('adminPages.assets');
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="assets-error">
      {t('error')}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminPages.assets');
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8" data-testid="assets-empty">
      {t('empty')}
    </p>
  );
}

function AssetGrid({ hook }: { hook: Hook }) {
  return (
    <div
      data-testid="assets-list"
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
    >
      {hook.assets.map((a) => <AssetCard key={a.asset_id} asset={a} hook={hook} />)}
    </div>
  );
}

function AssetCard({ asset, hook }: { asset: PoolAsset; hook: Hook }) {
  return (
    <div
      data-testid={`asset-card-${asset.asset_id}`}
      className="flex flex-col border border-(--color-rule) rounded-[3px] overflow-hidden"
    >
      <AssetPreview asset={asset} />
      <div className="flex items-baseline justify-between gap-2 px-3 py-2 border-t border-(--color-rule)">
        <span className="min-w-0 mono text-[10px] text-(--color-muted) truncate">
          {asset.original_filename} · {sizeLabel(asset.size_bytes)}
        </span>
        <DeleteButton asset={asset} hook={hook} />
      </div>
    </div>
  );
}

function AssetPreview({ asset }: { asset: PoolAsset }) {
  // Asset urls are dynamic MinIO-served blobs, not build-time imports, so next/image's static
  // optimizer can't handle them — a plain <img> is correct here.
  return isImage(asset) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={asset.url}
      alt={asset.original_filename}
      className="w-full h-28 object-cover bg-(--color-surface)"
    />
  ) : (
    <div className="w-full h-28 flex items-center justify-center bg-(--color-surface) mono text-[10px] tracking-[0.14em] uppercase text-(--color-faint)">
      {asset.content_type || 'file'}
    </div>
  );
}

function DeleteButton({ asset, hook }: { asset: PoolAsset; hook: Hook }) {
  const t = useTranslations('adminPages.assets');
  const run = useAction();
  return (
    <button
      type="button"
      data-testid={`asset-delete-${asset.asset_id}`}
      className="shrink-0 mono text-[10px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent)"
      onClick={() =>
        void run(() => hook.remove(asset.asset_id).then(hook.reload), { success: t('deleted') })
      }
    >
      {t('delete')}
    </button>
  );
}
