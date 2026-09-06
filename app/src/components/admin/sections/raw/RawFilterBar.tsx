// RawFilterBar — the filter chips at the top of the Raw section.

'use client';

import { useTranslations } from 'next-intl';

import type { RawFilter } from '@/lib/admin/use-raw';

const ORDER: readonly RawFilter[] = [
  'all', 'unprocessed', 'flagged-private', 'promoted',
];

// FILTER_KEY — the message key per filter. The label is translated; the RawFilter value
// itself (used in state / testids) stays the stable English union.
const FILTER_KEY: Record<RawFilter, string> = {
  'all': 'all',
  'unprocessed': 'unprocessed',
  'flagged-private': 'flaggedPrivate',
  'promoted': 'promoted',
};

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
  const t = useTranslations('adminCorpus.filter');
  const cls = active
    ? 'text-(--color-ink) border-b border-(--color-accent)'
    : 'text-(--color-muted) hover:text-(--color-ink)';
  return (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className={`mono text-[10.5px] tracking-[0.12em] uppercase px-2 py-1 transition-colors ${cls}`}
    >
      {t(FILTER_KEY[f])}
      <span className="text-(--color-faint) ml-1 tabular-nums">{count}</span>
    </button>
  );
}
