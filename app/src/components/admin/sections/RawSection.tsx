// RawSection —— /admin/raw 的设计稿版本。
// 顶部 SectionHeader + status filter chips + search/sort bar。中部 RawDumpBox。
// 下方 RawRow 列表，每行有 promote / edit / archive 操作。

'use client';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { ListFilterBar } from '@/components/admin/sections/corpus/ListFilterBar';
import { RawDumpBox } from '@/components/admin/sections/raw/RawDumpBox';
import { RawFilterBar } from '@/components/admin/sections/raw/RawFilterBar';
import { RawRowList } from '@/components/admin/sections/raw/RawRowList';
import { ListSkeleton } from '@/components/skeletons/ListSkeleton';
import { useListFilter } from '@/lib/admin/use-list-filter';
import { useRaw, type RawHook } from '@/lib/admin/use-raw';
import type { RawAdminView } from '@/lib/api/admin';

export function RawSection() {
  const hook = useRaw();
  return (
    <>
      <SectionHeader
        kicker="surface · inbox"
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
  // raw 有两层 filter：tier-status chips（unprocessed/promoted/archived/private）
  // 走原 hook.filter；search + sort 在 status filter 之后再过一遍。batch
  // archive 在 raw 里没做（行级 archive 已经够直接）。
  const filter = useListFilter<RawAdminView>({
    rows: hook.filteredRows,
    searchText: (r) => `${r.body} ${r.tags.join(' ')}`,
  });
  return (
    <div className="space-y-6">
      <RawFilterBar counts={hook.counts} filter={hook.filter} setFilter={hook.setFilter} />
      <RawDumpBox
        submitting={hook.submitting}
        submitError={hook.submitError}
        onAdd={hook.addRaw}
      />
      <ListFilterBar
        testidPrefix="raw"
        query={filter.query} setQuery={filter.setQuery}
        sort={filter.sort} setSort={filter.setSort}
        selectedCount={0}
        batchLabel=""
        onBatch={() => { /* no batch on raw */ }}
        onClearSelected={filter.clearSelected}
      />
      <RawRowList rows={filter.view} />
    </div>
  );
}
