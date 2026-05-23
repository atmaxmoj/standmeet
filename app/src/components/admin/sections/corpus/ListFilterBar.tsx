// ListFilterBar —— 列表顶部的 search + sort + 选中批量条。
// 三层 section 共用；prefix 区分 testid。

'use client';

import type { SortMode } from '@/lib/admin/use-list-filter';

export interface ListFilterBarProps {
  testidPrefix: string;
  query: string;
  setQuery: (v: string) => void;
  sort: SortMode;
  setSort: (m: SortMode) => void;
  selectedCount: number;
  batchLabel: string; // "delete N" / "archive N"
  onBatch: () => void;
  onClearSelected: () => void;
}

export function ListFilterBar(props: ListFilterBarProps) {
  return (
    <div className="mb-4 flex items-baseline gap-4 flex-wrap">
      <SearchInput
        testid={`${props.testidPrefix}-search`}
        value={props.query} onChange={props.setQuery}
      />
      <SortSelect
        testid={`${props.testidPrefix}-sort`}
        value={props.sort} onChange={props.setSort}
      />
      {props.selectedCount > 0 ? (
        <BatchPanel
          testidPrefix={props.testidPrefix}
          count={props.selectedCount}
          batchLabel={props.batchLabel}
          onBatch={props.onBatch}
          onClear={props.onClearSelected}
        />
      ) : null}
    </div>
  );
}

function SearchInput({
  value, onChange, testid,
}: { value: string; onChange: (v: string) => void; testid: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="search…"
      spellCheck={false}
      data-testid={testid}
      className="bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px] min-w-[180px]"
    />
  );
}

function SortSelect({
  value, onChange, testid,
}: { value: SortMode; onChange: (m: SortMode) => void; testid: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortMode)}
      data-testid={testid}
      className="bg-transparent border-b border-(--color-rule) py-1.5 mono text-[12px]"
    >
      <option value="newest">newest</option>
      <option value="oldest">oldest</option>
      <option value="title">title</option>
    </select>
  );
}

interface BatchPanelProps {
  testidPrefix: string;
  count: number;
  batchLabel: string;
  onBatch: () => void;
  onClear: () => void;
}

function BatchPanel(props: BatchPanelProps) {
  return (
    <div className="flex items-baseline gap-3 ml-auto" data-testid={`${props.testidPrefix}-batch`}>
      <span className="mono text-[10px] tracking-[0.12em] uppercase text-(--color-muted)">
        {props.count} selected
      </span>
      <button
        type="button"
        onClick={props.onBatch}
        data-testid={`${props.testidPrefix}-batch-submit`}
        className="mono text-[10px] tracking-[0.16em] uppercase text-(--color-paper) bg-(--color-accent) px-2.5 py-1 hover:opacity-80"
      >
        {props.batchLabel}
      </button>
      <button
        type="button"
        onClick={props.onClear}
        data-testid={`${props.testidPrefix}-batch-clear`}
        className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent)"
      >
        clear
      </button>
    </div>
  );
}
