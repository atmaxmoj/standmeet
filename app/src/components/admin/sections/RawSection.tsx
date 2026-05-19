// RawSection —— /admin/raw 的设计稿版本。
// 顶部 SectionHeader + filter chips。中部 RawDumpBox（占位 —— backend 没暴露
// POST /api/admin/raw，按提示走 MCP）。下方 RawRow 列表。

'use client';

import { SectionHeader } from '../SectionHeader';
import { RawDumpBox } from './raw/RawDumpBox';
import { RawFilterBar } from './raw/RawFilterBar';
import { RawRowList } from './raw/RawRowList';
import { useRaw, type RawHook } from '@/lib/admin/use-raw';

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
  return hook.state.kind === 'loading' ? <Loading />
    : hook.state.kind === 'error' ? <ErrorMsg message={hook.state.message} />
    : <Ready hook={hook} />;
}

function Loading() {
  return <p className="mono text-(--color-muted)">loading…</p>;
}

function ErrorMsg({ message }: { message: string }) {
  return <p className="mono text-(--color-accent)">{message}</p>;
}

function Ready({ hook }: { hook: RawHook }) {
  return (
    <div className="space-y-6">
      <RawFilterBar counts={hook.counts} filter={hook.filter} setFilter={hook.setFilter} />
      <RawDumpBox />
      <RawRowList rows={hook.filteredRows} />
    </div>
  );
}
