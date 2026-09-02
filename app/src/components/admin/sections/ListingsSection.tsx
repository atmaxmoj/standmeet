// ListingsSection —— /admin/listings. Design source: admin.js ListingsSection
// (1348-1406). Jobs fetched from sources, currently living in a Redis 1d-TTL pool.
// #50: wired to the real backend GET /api/admin/listings/ (read-only list;
// ranking/match is done by Claude on the client — this only shows the FetchedJob
// entries currently in the pool).

'use client';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useAdminListings, pickListingsBodyState, type AdminListingRow,
} from '@/lib/admin/use-admin-listings';

export function ListingsSection() {
  const { rows, loading, error } = useAdminListings();
  return (
    <>
      <SectionHeader
        kicker="jobs · listings"
        slug="listings"
        count={loading ? '' : `${rows.length} in pool`}
      />
      <Intro />
      <Body rows={rows} loading={loading} error={error} />
    </>
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

function ListingTable({ rows }: { rows: readonly AdminListingRow[] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="listings-list">
      {rows.map((j) => <ListingRow key={j.cache_id} job={j} />)}
    </ul>
  );
}

function ListingRow({ job }: { job: AdminListingRow }) {
  return (
    <li
      className="flex items-baseline justify-between gap-3 border border-(--color-rule) rounded-[3px] px-4 py-3"
      data-testid={`listing-row-${job.cache_id}`}
    >
      <span className="min-w-0">
        <span className="reading text-(--color-ink) text-[15px]">{job.title}</span>
        <span className="mono text-[10.5px] tracking-[0.12em] uppercase text-(--color-muted) ml-3">
          {job.company}
        </span>
      </span>
      <span className="mono text-[10.5px] text-(--color-faint) shrink-0">
        {fmtMeta(job)}
      </span>
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
