// SourcesSection —— /admin/sources。design 源 admin.js SourcesSection
// (1305-1343) + SourceConfigModal (1223-1303)。job 拉数据的 feed 源列表 +
// "+ board" / "+ rss/scraper" 入口。表格 (source / kind / new / total / last / status)。
//
// 走真数据:useAdminSources → GET /api/admin/job-sources/(jobsadmin routes)。空态是真
// 空态(没注册 source),不是占位。covered by admin-sources.spec.ts。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  useAdminSources, pickSourcesBodyState, type AdminSourceRow,
} from '@/lib/admin/use-admin-sources';

export function SourcesSection() {
  const { rows, loading, error } = useAdminSources();
  return (
    <>
      <SectionHeader
        kicker="jobs · sources"
        title="sources"
        count={loading ? '' : `${rows.length} active`}
        action={<ActionBtns />}
      />
      <Intro />
      <Body rows={rows} loading={loading} error={error} />
    </>
  );
}

function Body({
  rows, loading, error,
}: { rows: readonly AdminSourceRow[]; loading: boolean; error: string | null }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={error ?? ''} />,
    empty: <EmptyState />,
    list: <SourceTable rows={rows} />,
  } as const;
  return map[pickSourcesBodyState(rows.length, loading, error)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="sources-error">
      {message}
    </p>
  );
}

function SourceTable({ rows }: { rows: readonly AdminSourceRow[] }) {
  return (
    <ul className="flex flex-col gap-2" data-testid="sources-list">
      {rows.map((s) => <SourceRow key={s.id} source={s} />)}
    </ul>
  );
}

function SourceRow({ source }: { source: AdminSourceRow }) {
  return (
    <li
      className="flex items-baseline justify-between gap-3 border border-(--color-rule) rounded-[3px] px-4 py-3"
      data-testid={`source-row-${source.id}`}
    >
      <span className="min-w-0">
        <span className="reading text-(--color-ink) text-[15px]">{source.label}</span>
        <span className="mono text-[10.5px] tracking-[0.12em] uppercase text-(--color-muted) ml-3">
          {source.kind}
        </span>
      </span>
      <span className="mono text-[10.5px] text-(--color-faint) shrink-0">
        {fmtLast(source.last_fetched_at)}
      </span>
    </li>
  );
}

function fmtLast(iso: string | null | undefined): string {
  return iso ? `last · ${iso.slice(0, 10)}` : 'never fetched';
}

function ActionBtns() {
  return (
    <div className="flex gap-2">
      <button className="sm-btn sm-btn-outline sm-btn-sm" type="button">+ rss / scraper</button>
      <button className="sm-btn sm-btn-solid sm-btn-sm" type="button">+ board</button>
    </div>
  );
}

function Intro() {
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      Where the loop pulls listings from. Greenhouse / Lever / Wellfound are first-class; RSS and HTML scrapers
      are also supported. Each source is scanned every 30 minutes. Register sources via MCP{' '}
      <span className="mono text-(--color-ink)">jobs.register_source</span>.
    </p>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-(--color-rule) rounded-[3px] p-9 text-center">
      <div className="sm-smallcaps mb-1.5">no sources registered</div>
      <div className="font-serif text-[18px] text-(--color-ink)">Connect a job board or RSS feed.</div>
      <p className="reading text-[14px] text-(--color-muted) max-w-[36em] mx-auto mt-2">
        Ask Claude to run <span className="mono text-(--color-ink)">jobs.register_source</span> with
        a Greenhouse / Lever / RSS URL — it shows up here automatically.
      </p>
    </div>
  );
}
