// use-list-filter —— admin 列表的 search / sort / select 状态。
// client-side filter（list endpoint 已经返完整集合，N 期阶段 < 几千行）。
// 行 shape 必须有 id + created_at + title + 一段可搜的 text（body 或 title）。

'use client';

import { useCallback, useMemo, useState } from 'react';

export type SortMode = 'newest' | 'oldest' | 'title';

export interface FilterableRow {
  id: string;
  created_at: string;
}

export interface ListFilterHook<T extends FilterableRow> {
  query: string;
  setQuery: (v: string) => void;
  sort: SortMode;
  setSort: (m: SortMode) => void;
  selected: ReadonlySet<string>;
  toggleSelected: (id: string) => void;
  toggleAll: (rows: readonly T[]) => void;
  clearSelected: () => void;
  view: readonly T[]; // filtered + sorted
}

export interface UseListFilterOpts<T> {
  rows: readonly T[];
  searchText: (row: T) => string; // 拼一段用来 substring 匹配
}

export function useListFilter<T extends FilterableRow>(
  opts: UseListFilterOpts<T>,
): ListFilterHook<T> {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('newest');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const view = useMemo(
    () => sortRows(filterRows(opts.rows, query, opts.searchText), sort),
    [opts.rows, query, sort, opts.searchText],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => toggleIn(prev, id));
  }, []);

  const toggleAll = useCallback((rows: readonly T[]) => {
    setSelected((prev) => toggleAllIn(prev, rows));
  }, []);

  const clearSelected = useCallback(() => setSelected(new Set()), []);

  return {
    query, setQuery, sort, setSort,
    selected, toggleSelected, toggleAll, clearSelected,
    view,
  };
}

function filterRows<T>(rows: readonly T[], query: string, text: (row: T) => string): readonly T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return rows;
  return rows.filter((r) => text(r).toLowerCase().includes(q));
}

function sortRows<T extends FilterableRow & { title?: string }>(
  rows: readonly T[], mode: SortMode,
): readonly T[] {
  return [...rows].sort(sortComparator(mode));
}

function sortComparator<T extends FilterableRow & { title?: string }>(mode: SortMode) {
  return (a: T, b: T): number => compareBy(mode, a, b);
}

function compareBy<T extends FilterableRow & { title?: string }>(
  mode: SortMode, a: T, b: T,
): number {
  if (mode === 'title') return (a.title ?? '').localeCompare(b.title ?? '');
  const cmp = a.created_at.localeCompare(b.created_at);
  return mode === 'newest' ? -cmp : cmp;
}

function toggleIn(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev);
  next.has(id) ? next.delete(id) : next.add(id);
  return next;
}

function toggleAllIn<T extends FilterableRow>(
  prev: Set<string>, rows: readonly T[],
): Set<string> {
  const allSelected = rows.every((r) => prev.has(r.id));
  return allSelected ? new Set() : new Set(rows.map((r) => r.id));
}
