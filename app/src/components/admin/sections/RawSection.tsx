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
import { useRaw, type RawHook } from '@/lib/admin/use-raw';

export function RawSection() {
  const hook = useRaw();
  return (
    <>
      <SectionHeader
        kicker="corpus · inbox"
        title="raw"
        count={`${hook.counts.unprocessed} unprocessed`}
      />
      <RawBody hook={hook} />
    </>
  );
}

function RawBody({ hook }: { hook: RawHook }) {
  return hook.status === 'idle' || hook.status === 'loading'
    ? <ListSkeleton count={4} />
    : <Ready hook={hook} />;
}

function Ready({ hook }: { hook: RawHook }) {
  return (
    <div className="space-y-6">
      <RawFilterBar counts={hook.counts} filter={hook.filter} setFilter={hook.setFilter} />
      <RawDumpBox
        submitting={hook.submitting}
        submitError={hook.submitError}
        onAdd={hook.addRaw}
      />
      <RawRowList rows={hook.filteredRows} />
    </div>
  );
}
