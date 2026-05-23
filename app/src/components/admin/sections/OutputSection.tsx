// OutputSection —— /admin/output。raw → wiki → output 三层最精炼层。
// 列出 owner 通过 MCP promote_wiki_to_output 提炼的 output 条目。
// 列视图，跟 WikiSection 同构；CRUD UI 留下一轮做。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { Pill } from '@/components/admin/atoms/Pill';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import {
  pickOutputBodyState,
  useOutput,
  type OutputHook,
  type OutputSummary,
} from '@/lib/admin/use-output';

export function OutputSection() {
  const hook = useOutput();
  return (
    <>
      <SectionHeader
        kicker="surface · polished"
        title="output"
        count={hook.status === 'ready' ? `${hook.rows.length} entries` : ''}
      />
      <OutputBody hook={hook} />
    </>
  );
}

function OutputBody({ hook }: { hook: OutputHook }) {
  const map = {
    loading: <ListSkeleton count={3} />,
    error: <ErrorBlock message={hook.error ?? ''} />,
    empty: <EmptyState />,
    list: <OutputList rows={hook.rows} />,
  } as const;
  return map[pickOutputBodyState(hook)];
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <p className="mono text-[11px] text-(--color-accent) mt-8" data-testid="output-error">
      {message}
    </p>
  );
}

function EmptyState() {
  return (
    <p className="reading-tight italic text-(--color-muted) mt-8">
      No output entries yet. Owner promotes wiki → output via MCP{' '}
      (<span className="mono">promote_wiki_to_output</span>).
    </p>
  );
}

function OutputList({ rows }: { rows: readonly OutputSummary[] }) {
  return (
    <ul className="space-y-4" data-testid="output-list">
      {rows.map((o) => (
        <li key={o.id} data-testid={`output-row-${o.id}`}>
          <OutputCard entry={o} />
        </li>
      ))}
    </ul>
  );
}

function OutputCard({ entry }: { entry: OutputSummary }) {
  return (
    <article className="border border-(--color-rule) p-5 rounded-sm bg-(--color-surface)/30">
      <OutputHead entry={entry} />
      <OutputTags tags={entry.tags} />
    </article>
  );
}

function OutputHead({ entry }: { entry: OutputSummary }) {
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

function OutputTags({ tags }: { tags: readonly string[] }) {
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
