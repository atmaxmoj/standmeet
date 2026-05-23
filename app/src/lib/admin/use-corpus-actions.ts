// use-corpus-actions —— raw / wiki / output 三层的 update / delete /
// create / promote actions hook。
//
// 每个 action 返回 Promise<boolean>（成功 true，失败 false 并 setError）。
// 调用方负责 toast；list stores 在 mutation 后 reset → 下次访问 refetch。

'use client';

import { useCallback, useState } from 'react';

import { adminAPI, type RawAdminView } from '@/lib/api/admin';

import { outputStore, type OutputSummary } from '@/lib/admin/use-output';
import { rawStore } from '@/lib/admin/use-raw';
import { wikiStore, type WikiSummary } from '@/lib/admin/use-wiki';

export interface RawUpdateInput {
  body: string;
  tags?: string[];
  flagged_private?: boolean;
}

export interface CorpusEntryInput {
  title: string;
  body: string;
  tags?: string[];
  parent_id?: string;
  show_as_source?: boolean;
}

export interface PromoteInput {
  title: string;
  tags?: string[];
  parent_id?: string;
}

// 详情 view（GET single 返）—— 比 list summary 多 body + source_*_ids + SEO，
// EditForm 展开时 fetch 它回填 body 字段。
export interface WikiDetail {
  id: string;
  title: string;
  body: string;
  tags: string[];
  source_raw_ids: string[];
  parent_id?: string | null;
  path?: string | null;
  show_as_source: boolean;
  seo_description: string;
  seo_indexed: boolean;
}

export interface OutputDetail {
  id: string;
  title: string;
  body: string;
  tags: string[];
  source_wiki_ids: string[];
  parent_id?: string | null;
  path?: string | null;
  show_as_source: boolean;
  seo_description: string;
  seo_indexed: boolean;
}

// PathUpdateInput —— PATCH /wiki/{id}/seo + /output/{id}/seo 入参。
// 字段名重设：seo_slug → path。SEO description/indexed 继续在同一 endpoint。
export interface PathUpdateInput {
  path: string | null;
  seo_description: string;
  seo_indexed: boolean;
}

export interface CorpusActionsHook {
  pending: boolean;
  error: string | null;
  // raw
  updateRaw: (id: string, input: RawUpdateInput) => Promise<boolean>;
  archiveRaw: (id: string) => Promise<boolean>;
  promoteRaw: (id: string, input: PromoteInput) => Promise<boolean>;
  // wiki
  createWiki: (input: CorpusEntryInput) => Promise<boolean>;
  updateWiki: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  deleteWiki: (id: string) => Promise<boolean>;
  promoteWiki: (id: string, input: PromoteInput) => Promise<boolean>;
  fetchWikiDetail: (id: string) => Promise<WikiDetail | null>;
  updateWikiSEO: (id: string, input: PathUpdateInput) => Promise<boolean>;
  // output
  createOutput: (input: CorpusEntryInput) => Promise<boolean>;
  updateOutput: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  deleteOutput: (id: string) => Promise<boolean>;
  fetchOutputDetail: (id: string) => Promise<OutputDetail | null>;
  updateOutputSEO: (id: string, input: PathUpdateInput) => Promise<boolean>;
  clearError: () => void;
}

export function useCorpusActions(): CorpusActionsHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = makeRun(setPending, setError);
  return {
    pending, error,
    updateRaw: useCallback(
      (id, input) => run(() => doUpdateRaw(id, input)), [run]),
    archiveRaw: useCallback(
      (id) => run(() => doArchiveRaw(id)), [run]),
    promoteRaw: useCallback(
      (id, input) => run(() => doPromoteRaw(id, input)), [run]),
    createWiki: useCallback(
      (input) => run(() => doCreateWiki(input)), [run]),
    updateWiki: useCallback(
      (id, input) => run(() => doUpdateWiki(id, input)), [run]),
    deleteWiki: useCallback(
      (id) => run(() => doDeleteWiki(id)), [run]),
    promoteWiki: useCallback(
      (id, input) => run(() => doPromoteWiki(id, input)), [run]),
    fetchWikiDetail: useCallback(
      (id: string) => fetchDetail<WikiDetail>(`/wiki/${id}`, setError, setPending), []),
    updateWikiSEO: useCallback(
      (id, input) => run(() => doUpdateWikiSEO(id, input)), [run]),
    createOutput: useCallback(
      (input) => run(() => doCreateOutput(input)), [run]),
    updateOutput: useCallback(
      (id, input) => run(() => doUpdateOutput(id, input)), [run]),
    deleteOutput: useCallback(
      (id) => run(() => doDeleteOutput(id)), [run]),
    fetchOutputDetail: useCallback(
      (id: string) => fetchDetail<OutputDetail>(`/output/${id}`, setError, setPending), []),
    updateOutputSEO: useCallback(
      (id, input) => run(() => doUpdateOutputSEO(id, input)), [run]),
    clearError: useCallback(() => setError(null), []),
  };
}

async function fetchDetail<T>(
  path: string,
  setError: (m: string | null) => void,
  setPending: (b: boolean) => void,
): Promise<T | null> {
  setPending(true);
  setError(null);
  try {
    return await adminAPI.get<T>(path);
  } catch (e) {
    setError(e instanceof Error ? e.message : 'fetch failed');
    return null;
  } finally {
    setPending(false);
  }
}

type Runner = (fn: () => Promise<void>) => Promise<boolean>;

function makeRun(
  setPending: (b: boolean) => void, setError: (m: string | null) => void,
): Runner {
  return async (fn) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
      return false;
    } finally {
      setPending(false);
    }
  };
}

// ─── raw ────────────────────────────────────────────────────

async function doUpdateRaw(id: string, input: RawUpdateInput): Promise<void> {
  const updated = await adminAPI.patch<RawAdminView>(`/raw/${id}`, {
    body: input.body, tags: input.tags ?? [],
    flagged_private: input.flagged_private ?? false,
  });
  rawStore.getState().mutate(
    (prev) => (prev ?? []).map((r) => r.id === id ? updated : r),
  );
}

async function doArchiveRaw(id: string): Promise<void> {
  await adminAPI.delete(`/raw/${id}`);
  rawStore.getState().mutate(
    (prev) => (prev ?? []).map((r) => r.id === id ? { ...r, archived: true } : r),
  );
}

async function doPromoteRaw(id: string, input: PromoteInput): Promise<void> {
  await adminAPI.post(`/raw/${id}/promote`, input);
  // raw row 没有 promoted_to 字段在前端 view 里；只 refresh 让后端的状态回灌。
  rawStore.getState().reset();
  wikiStore.getState().reset();
}

// ─── wiki ───────────────────────────────────────────────────

async function doCreateWiki(input: CorpusEntryInput): Promise<void> {
  const created = await adminAPI.post<WikiSummary>('/wiki', input);
  wikiStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
}

async function doUpdateWiki(id: string, input: CorpusEntryInput): Promise<void> {
  const updated = await adminAPI.patch<WikiSummary>(`/wiki/${id}`, input);
  wikiStore.getState().mutate(
    (prev) => (prev ?? []).map((w) => w.id === id ? updated : w),
  );
}

async function doDeleteWiki(id: string): Promise<void> {
  await adminAPI.delete(`/wiki/${id}`);
  wikiStore.getState().mutate((prev) => (prev ?? []).filter((w) => w.id !== id));
}

async function doPromoteWiki(id: string, input: PromoteInput): Promise<void> {
  await adminAPI.post(`/wiki/${id}/promote`, input);
  outputStore.getState().reset();
}

async function doUpdateWikiSEO(id: string, input: PathUpdateInput): Promise<void> {
  await adminAPI.patch(`/wiki/${id}/seo`, input);
  wikiStore.getState().reset();
}

// ─── output ─────────────────────────────────────────────────

async function doCreateOutput(input: CorpusEntryInput): Promise<void> {
  const created = await adminAPI.post<OutputSummary>('/output', input);
  outputStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
}

async function doUpdateOutput(id: string, input: CorpusEntryInput): Promise<void> {
  const updated = await adminAPI.patch<OutputSummary>(`/output/${id}`, input);
  outputStore.getState().mutate(
    (prev) => (prev ?? []).map((o) => o.id === id ? updated : o),
  );
}

async function doDeleteOutput(id: string): Promise<void> {
  await adminAPI.delete(`/output/${id}`);
  outputStore.getState().mutate((prev) => (prev ?? []).filter((o) => o.id !== id));
}

async function doUpdateOutputSEO(id: string, input: PathUpdateInput): Promise<void> {
  await adminAPI.patch(`/output/${id}/seo`, input);
  outputStore.getState().reset();
}
