// ListingsSection —— /admin/listings. Jobs fetched from sources, currently living in a
// Redis 1d-TTL pool. Design source: admin.js ListingsSection (1348-1406).
//
// Two changes the owner asked for, touring the live instance:
//   · **Auto-fetch, not "go ask Claude"** — the section pulls new jobs itself (once per
//     session on open, plus a manual button); the wiring is in use-admin-listings.
//   · **Virtual list** — the pool can hold a thousand-plus rows; render only what's on
//     screen (@tanstack/react-virtual) so a big pool doesn't paint a thousand DOM nodes.

'use client';

import { useRef } from 'react';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useAdminListings, pickListingsBodyState, type AdminListingRow,
} from '@/lib/admin/use-admin-listings';

const ROW_PX = 64;

export function ListingsSection() {
  const hook = useAdminListings();
  return (
    <>
      <SectionHeader
        kicker="jobs · listings"
        slug="listings"
        count={hook.loading ? '' : `${hook.rows.length} in pool`}
      />
      <Intro />
      <FetchBar fetching={hook.fetching} onFetch={hook.fetchNow} />
      <Body rows={hook.rows} loading={hook.loading} error={hook.error} />
    </>
  );
}

// FetchBar —— the manual "fetch now" control. Auto-fetch already runs on the first open
// this session; this is for pulling again on demand, and it's what replaces the old
// "ask Claude to run jobs.fetch_new" instruction.
function FetchBar({ fetching, onFetch }: { fetching: boolean; onFetch: () => Promise<void> }) {
  const t = useTranslations('adminJobs');
  return (
    <div className="mb-4">
      <button
        type="button" onClick={() => void onFetch()} disabled={fetching}
        data-testid="listings-fetch"
        className="sm-btn sm-btn-sm disabled:opacity-40"
      >
        {fetching ? t('listings.fetching') : t('listings.fetchNow')}
      </button>
    </div>
  );
}

function Body({
  rows, loading, error,
}: { rows: readonly AdminListingRow[]; loading: boolean; error: string | null }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={error ?? ''} />,
    empty: <EmptyState />,
    list: <ListingTable rows={rows} />,
  } as const;
  return map[pickListingsBodyState(rows.length, loading, error)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="listings-error">
      {message}
    </p>
  );
}

// ListingTable —— the virtualized pool. Only the rows in view (plus a small overscan)
// are in the DOM; a scroll offset picks which. estimateSize is fixed because each row is
// clamped to one line (truncated title), so no row is taller than ROW_PX.
function ListingTable({ rows }: { rows: readonly AdminListingRow[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_PX,
    overscan: 10,
  });
  return (
    <div ref={parentRef} data-testid="listings-list" className="max-h-[600px] overflow-auto pr-1">
      {/* eslint-disable-next-line no-restricted-syntax -- virtualizer needs the runtime total height */}
      <div style={{ height: `${virt.getTotalSize()}px`, position: 'relative' }}>
        {virt.getVirtualItems().map((vi) => (
          <VirtualRow key={rows[vi.index]!.cache_id} job={rows[vi.index]!} start={vi.start} />
        ))}
      </div>
    </div>
  );
}

function VirtualRow({ job, start }: { job: AdminListingRow; start: number }) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- virtualizer positions each row at a runtime offset
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${start}px)` }}>
      <ListingRow job={job} />
    </div>
  );
}

function ListingRow({ job }: { job: AdminListingRow }) {
  return (
    <li className="list-none mb-2" data-testid={`listing-row-${job.cache_id}`}>
      <a
        href={job.url || undefined}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`listing-link-${job.cache_id}`}
        className="flex items-baseline justify-between gap-3 border border-(--color-rule) rounded-[3px] px-4 py-3 no-underline text-inherit hover:border-(--color-ink) transition-colors"
      >
        <span className="min-w-0 truncate">
          <span className="reading text-(--color-ink) text-[15px]">{job.title}</span>
          <span className="mono text-[10.5px] tracking-[0.12em] uppercase text-(--color-muted) ml-3">
            {job.company}
          </span>
        </span>
        <span className="mono text-[10.5px] text-(--color-faint) shrink-0">
          {fmtMeta(job)}
        </span>
      </a>
    </li>
  );
}

function fmtMeta(job: AdminListingRow): string {
  const where = job.location ? ` · ${job.location}` : '';
  return `${job.source_kind}${where}`;
}

// mono —— the <mono> tag for t.rich: renders an MCP tool name as monospace ink.
const mono = (chunks: React.ReactNode) => (
  <span className="mono text-(--color-ink)">{chunks}</span>
);

function Intro() {
  const t = useTranslations('adminJobs');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t.rich('listings.intro', { mono })}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-empty">
      <div className="sm-smallcaps mb-1.5">{t('listings.emptyKicker')}</div>
      <div className="sm-empty-title">{t('listings.emptyTitle')}</div>
      <p className="sm-empty-hint reading">
        {t.rich('listings.emptyHint', { mono })}
      </p>
    </div>
  );
}
