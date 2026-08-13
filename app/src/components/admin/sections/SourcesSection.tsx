// SourcesSection —— /admin/sources。design 源 admin.js SourcesSection
// (1305-1343) + SourceConfigModal (1223-1303)。job 拉数据的 feed 源列表 +
// "+ board" / "+ rss/scraper" 入口。表格 (source / kind / new / total / last / status)。
//
// 走真数据:useAdminSources → GET /api/admin/job-sources/(jobsadmin routes)。空态是真
// 空态(没注册 source),不是占位。covered by admin-sources.spec.ts。

'use client';

import { useTranslations } from 'next-intl';

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

// F-E-1: the old "+ rss/scraper" / "+ board" header buttons were dead (no onClick) and
// contradicted this page's own copy — job sources are registered via the jobs.register_source
// MCP tool (Claude Code), not an admin form. Removed; the Intro + empty state direct to MCP.

// mono —— t.rich 的 <mono> 标签：把 MCP 工具名渲染成等宽 ink。
const mono = (chunks: React.ReactNode) => (
  <span className="mono text-(--color-ink)">{chunks}</span>
);

function Intro() {
  const t = useTranslations('adminJobs');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]">
      {t.rich('sources.intro', { mono })}
    </p>
  );
}

function EmptyState() {
  const t = useTranslations('adminJobs');
  return (
    <div className="sm-empty">
      <div className="sm-smallcaps mb-1.5">{t('sources.emptyKicker')}</div>
      <div className="sm-empty-title">{t('sources.emptyTitle')}</div>
      <p className="sm-empty-hint reading">
        {t.rich('sources.emptyHint', { mono })}
      </p>
    </div>
  );
}
