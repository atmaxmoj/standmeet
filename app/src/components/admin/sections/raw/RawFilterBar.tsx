// RawFilterBar —— Raw section 顶部的 filter chips。

import type { RawFilter } from '@/lib/admin/use-raw';

const ORDER: readonly RawFilter[] = [
  'all', 'unprocessed', 'flagged-private', 'promoted',
];

type Props = {
  filter: RawFilter;
  counts: Record<RawFilter, number>;
  setFilter: (f: RawFilter) => void;
};

export function RawFilterBar({ filter, counts, setFilter }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ORDER.map((f) => (
        <FilterButton key={f} f={f} active={f === filter} count={counts[f]} setFilter={setFilter} />
      ))}
    </div>
  );
}

function FilterButton({
  f, active, count, setFilter,
}: { f: RawFilter; active: boolean; count: number; setFilter: (f: RawFilter) => void }) {
  const cls = active
    ? 'text-(--color-ink) border-b border-(--color-accent)'
    : 'text-(--color-muted) hover:text-(--color-ink)';
  return (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className={`mono text-[10.5px] tracking-[0.12em] uppercase px-2 py-1 transition-colors ${cls}`}
    >
      {f.replace('-', ' ')}
      <span className="text-(--color-faint) ml-1 tabular-nums">{count}</span>
    </button>
  );
}
