// ListingsSection —— /admin/listings。design 源 admin.js ListingsSection
// (1348-1406)。jobs fetched from sources, 现存于 Redis 1d-TTL 池子。
// #50: 接真后端 GET /api/admin/listings/(列表只读;ranking/match 是
// Claude 在客户端做的事,这里只展示池子里现存的 FetchedJob)。

'use client';

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
        title="listings"
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

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Jobs fetched from your registered sources, held in a 1-day pool. Ask Claude to rank them
      against your corpus and draft a resume for the ones worth applying to. Pool TTL 1 day;
      missed it, fetch again via MCP{' '}
      <span className="mono text-(--color-ink)">jobs.fetch_new</span>.
    </p>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-(--color-rule) rounded-[3px] p-9 text-center">
      <div className="sm-smallcaps mb-1.5">no listings in pool</div>
      <div className="font-serif text-[18px] text-(--color-ink)">Fetch jobs from your sources first.</div>
      <p className="reading text-[14px] text-(--color-muted) max-w-[36em] mx-auto mt-2">
        Ask Claude to run <span className="mono text-(--color-ink)">jobs.fetch_new</span> —
        results land here for a day until you draft or discard them.
      </p>
    </div>
  );
}
