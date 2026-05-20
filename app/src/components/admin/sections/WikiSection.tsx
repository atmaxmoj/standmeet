// WikiSection —— /admin/wiki。列出 owner promote 进 wiki 的条目；每条
// 显示 title / visibility badge / tags / created date。编辑能力 / promote 流
// 暂未做（owner 通过 MCP 走）。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Pill } from '@/components/admin/atoms/Pill';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  pickWikiBodyState,
  useWiki,
  type WikiHook,
  type WikiSummary,
} from '@/lib/admin/use-wiki';

export function WikiSection() {
  const hook = useWiki();
  return (
    <>
      <SectionHeader
        kicker="surface · curated"
        title="wiki"
        count={hook.status === 'ready' ? `${hook.rows.length} entries` : ''}
      />
      <WikiBody hook={hook} />
    </>
  );
}

function WikiBody({ hook }: { hook: WikiHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <WikiList rows={hook.rows} />,
  } as const;
  return map[pickWikiBodyState(hook)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="wiki-error">
      {message}
    </p>
  );
}

function EmptyState() {
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No wiki entries yet. Owner promotes raw → wiki via MCP{' '}
      (<span className="mono">custom_page.promote_to_wiki</span>) or admin/raw.
    </p>
  );
}

function WikiList({ rows }: { rows: readonly WikiSummary[] }) {
  return (
    <ul className="space-y-4" data-testid="wiki-list">
      {rows.map((w) => (
        <li key={w.id} data-testid={`wiki-row-${w.id}`}>
          <WikiCard entry={w} />
        </li>
      ))}
    </ul>
  );
}

function WikiCard({ entry }: { entry: WikiSummary }) {
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <WikiHead entry={entry} />
      <WikiTags tags={entry.tags} />
    </article>
  );
}

function WikiHead({ entry }: { entry: WikiSummary }) {
  return (
    <div className="flex items-baseline justify-between gap-4 flex-wrap">
      <h3 className="font-serif text-(--color-ink)" style={{ fontSize: '18px', fontWeight: 500 }}>
        {entry.title}
      </h3>
      <div className="flex items-baseline gap-3">
        <Pill tone={entry.visibility === 'public' ? 'accent' : 'muted'}>{entry.visibility}</Pill>
        <span className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-faint)">
          {formatDate(entry.created_at)}
        </span>
      </div>
    </div>
  );
}

function WikiTags({ tags }: { tags: readonly string[] }) {
  return tags.length === 0 ? null : (
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map((t) => (
        <span key={t} className="mono text-[10px] tracking-[0.08em] text-(--color-muted)">#{t}</span>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}
