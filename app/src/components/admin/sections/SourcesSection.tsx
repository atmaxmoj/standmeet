// SourcesSection —— /admin/sources. Design source admin.js SourcesSection
// (1305-1343) + SourceConfigModal (1223-1303). List of feed sources jobs pulls data from +
// "+ board" / "+ rss/scraper" entry points. Table (source / kind / new / total / last / status).
//
// Runs on real data: useAdminSources → GET /api/admin/job-sources/ (jobsadmin routes). The empty
// state is a genuine empty state (no source registered), not a placeholder. covered by admin-sources.spec.ts.

'use client';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { sourceFailed, sourceStateLine } from '@/lib/admin/source-state';
import {
  useAdminSources, pickSourcesBodyState, type AdminSourceRow,
} from '@/lib/admin/use-admin-sources';

export function SourcesSection() {
  const { rows, loading, error } = useAdminSources();
  return (
    <>
      <SectionHeader
        kicker="jobs · sources"
        slug="sources"
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
      <SourceState source={source} />
    </li>
  );
}

// SourceState —— the text on the right side of this row. **Three states, three different messages**:
// never tried / last try failed (with reason) / last try succeeded (with date).
// It used to have only `last_fetched_at` as a source, so a "source that 400s every time" and a
// "source that's never been touched" both printed `never fetched` — while the whole reason this
// page exists is to answer "is this source still alive" (F-E-18).
function SourceState({ source }: { source: AdminSourceRow }) {
  const tone = sourceFailed(source) ? 'text-(--color-accent)' : 'text-(--color-faint)';
  return (
    <span
      className={`mono text-[10.5px] shrink-0 text-right max-w-[52%] ${tone}`}
      data-testid={`source-state-${source.id}`}
    >
      {sourceStateLine(source)}
    </span>
  );
}

// F-E-1: the old "+ rss/scraper" / "+ board" header buttons were dead (no onClick) and
// contradicted this page's own copy — job sources are registered via the jobs.register_source
// MCP tool (Claude Code), not an admin form. Removed; the Intro + empty state direct to MCP.

// mono —— the <mono> tag for t.rich: renders MCP tool names as monospace ink.
const mono = (chunks: React.ReactNode) => (
  <span className="mono text-(--color-ink)">{chunks}</span>
);

function Intro() {
  const t = useTranslations('adminJobs');
  return (
    <p className="reading text-[14.5px] text-(--color-muted) mb-6 max-w-[54em]" data-testid="sources-intro">
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
