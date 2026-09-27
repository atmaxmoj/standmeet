// RawSection —— version aligned with the /admin/raw design mockup.
// SectionHeader (kicker + title + N unprocessed) + 4-tab status filter
// (all/unprocessed/flagged-private/promoted) + DumpBox + RawRowList.
//
// Design source docs/design/project/admin.js RawSection.
// Removed ListFilterBar (search + sort) — the inbox is a stream-and-drain scenario, filter chips
// + row-level delete are enough; add search once volume is genuinely large.

'use client';

import { useTranslations } from 'next-intl';

import { SectionHeader } from '@/components/admin/SectionHeader';
import { RawDumpBox } from '@/components/admin/sections/raw/RawDumpBox';
import { RawFilterBar } from '@/components/admin/sections/raw/RawFilterBar';
import { RawRowList } from '@/components/admin/sections/raw/RawRowList';
import { useRaw } from '@/lib/admin/use-raw';
import { totalLabel } from '@/lib/state/create-paged-store';

// The header and every tab count come from the server (each tab's own filter total), never from
// the loaded page: the tabs once showed the loaded 50 while the header said 170 (F-L-5).
export function RawSection() {
  const tk = useTranslations('adminCorpus.kicker');
  const tc = useTranslations('adminCorpus.count');
  const hook = useRaw();
  return (
    <>
      <SectionHeader
        kicker={tk('raw')} slug="raw"
        count={totalLabel(hook.counts?.unprocessed ?? null, (n) => tc('unprocessed', { n }))}
      />
      <div className="space-y-6">
        <RawFilterBar counts={hook.counts} filter={hook.filter} setFilter={hook.setFilter} />
        <RawDumpBox
          submitting={hook.submitting}
          submitError={hook.submitError}
          onAdd={hook.addRaw}
        />
        <RawRowList page={hook.page} />
      </div>
    </>
  );
}
