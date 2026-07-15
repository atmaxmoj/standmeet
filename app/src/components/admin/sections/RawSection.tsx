// RawSection —— /admin/raw 设计稿对齐版。
// SectionHeader (kicker + title + N unprocessed) + 4-tab status filter
// (all/unprocessed/flagged-private/promoted) + DumpBox + RawRowList。
//
// 设计源 docs/design/project/admin.js RawSection (315-343)。
// 删了 ListFilterBar (search + sort) —— inbox 是流式排空场景，filter chips
// + 行级 archive 就够；search 在数量真大时再加。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { RawDumpBox } from '@/components/admin/sections/raw/RawDumpBox';
import { RawFilterBar } from '@/components/admin/sections/raw/RawFilterBar';
import { RawRowList } from '@/components/admin/sections/raw/RawRowList';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { useCorpusGrowth } from '@/lib/admin/use-corpus-growth';
import { useRaw, type RawHook, type RawFilter } from '@/lib/admin/use-raw';

// rawTrueCounts —— ALL + UNPROCESSED reflect the real COUNT(*) (growth), not the loaded first
// page. The header did this already (F-L-4); the filter TABS did not (F-L-5) — they showed the
// loaded 50 while the header showed 170. flagged/promoted/archived have no growth breakdown, so
// they stay from the loaded page (they don't exceed a page today; per-status COUNT(*) is the
// follow-up if that changes). Growth may be undefined mid-load → fall back to the loaded count.
function rawTrueCounts(
  loaded: Record<RawFilter, number>, growth: ReturnType<typeof useCorpusGrowth>['growth'],
): { unprocessed: number; tabs: Record<RawFilter, number> } {
  const tier: { raw: number; raw_unprocessed: number } =
    growth?.by_tier ?? { raw: loaded.all, raw_unprocessed: loaded.unprocessed };
  return {
    unprocessed: tier.raw_unprocessed,
    tabs: { ...loaded, all: tier.raw, unprocessed: tier.raw_unprocessed },
  };
}

export function RawSection() {
  const hook = useRaw();
  const { growth } = useCorpusGrowth();
  const { unprocessed, tabs } = rawTrueCounts(hook.counts, growth);
  return (
    <>
      <SectionHeader kicker="corpus · inbox" title="raw" count={`${unprocessed} unprocessed`} />
      <RawBody hook={hook} tabCounts={tabs} />
    </>
  );
}

function RawBody({ hook, tabCounts }: { hook: RawHook; tabCounts: Record<RawFilter, number> }) {
  return hook.status === 'idle' || hook.status === 'loading'
    ? <ListSkeleton count={4} />
    : <Ready hook={hook} tabCounts={tabCounts} />;
}

function Ready({ hook, tabCounts }: { hook: RawHook; tabCounts: Record<RawFilter, number> }) {
  return (
    <div className="space-y-6">
      <RawFilterBar counts={tabCounts} filter={hook.filter} setFilter={hook.setFilter} />
      <RawDumpBox
        submitting={hook.submitting}
        submitError={hook.submitError}
        onAdd={hook.addRaw}
      />
      <RawRowList rows={hook.filteredRows} />
    </div>
  );
}
