// use-corpus-actions —— raw / wiki / output 三层的 update / delete /
// create / promote actions hook。
//
// 每个 action 返回 Promise<boolean>（成功 true，失败 false 并 setError）。
// 调用方负责 toast；list stores 在 mutation 后 reset → 下次访问 refetch。

'use client';

import { useCallback, useState } from 'react';

import { z } from 'zod';

import { adminAPI, RawAdminViewSchema } from '@/lib/api/admin';
import { onCorpusChanged } from '@/lib/admin/corpus-changed';

import { outputStore, OutputSummarySchema } from '@/lib/admin/use-output';
import { rawStore } from '@/lib/admin/use-raw';
import { subjectivityStore, SubjectivitySummarySchema } from '@/lib/admin/use-subjectivity';
import { wikiStore, WikiSummarySchema } from '@/lib/admin/use-wiki';

export interface RawUpdateInput {
  body: string;
  tags?: string[];
  flagged_private?: boolean;
  // hero 三件套 —— 图 + 压在图上那句话 + 色调。后端是指针字段:不发 = 不动,发空串 = 清掉。
  cover_image_asset_id?: string;
  cover_headline?: string;
  cover_hue?: string;
}

export interface CorpusEntryInput {
  title: string;
  body: string;
  tags?: string[];
  parent_id?: string;
  show_as_source?: boolean;
  // hero 三件套 —— 图用哪份素材 + 压在图上那句话 + 色调。后端是指针字段:不发 = 不动。
  cover_image_asset_id?: string;
  cover_headline?: string;
  cover_hue?: string;
}

export interface PromoteInput {
  title: string;
  tags?: string[];
  parent_id?: string;
}

// 详情 view（GET single 返）—— 比 list summary 多 body + source_*_ids + SEO，
// EditForm 展开时 fetch 它回填 body 字段。
// detail 不带 path:地址树派生(浏览列表那条由后端算并回显),编辑表单无 path 字段。
const WikiDetailSchema = z.object({
  id: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()),
  source_raw_ids: z.array(z.string()),
  parent_id: z.string().nullable().optional(),
  show_as_source: z.boolean(), excerpt: z.string(), published: z.boolean(),
  // hero 图。omitempty:没设过封面时字段不在 —— 那是"没有",不是坏了。
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
});
export type WikiDetail = z.infer<typeof WikiDetailSchema>;

// raw 的详情 —— 只为 hero 三件套。raw 的行内编辑框其余字段直接用列表行(它带 body),
// 但 hero 不在列表里(每行算一次素材太贵)。
const RawDetailSchema = z.object({
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
});
export type RawDetail = z.infer<typeof RawDetailSchema>;

// subjectivity 的详情。它没有 excerpt / published(那是对外发布才有的概念),
// 其余跟 wiki 一致 —— 不适用的字段不该硬凑一个出来。
const SubjectivityDetailSchema = z.object({
  id: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()),
  parent_id: z.string().nullable().optional(),
  show_as_source: z.boolean(),
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
});
export type SubjectivityDetail = z.infer<typeof SubjectivityDetailSchema>;

const OutputDetailSchema = z.object({
  id: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()),
  source_wiki_ids: z.array(z.string()),
  parent_id: z.string().nullable().optional(),
  show_as_source: z.boolean(), excerpt: z.string(), published: z.boolean(),
  // hero 图。omitempty:没设过封面时字段不在 —— 那是"没有",不是坏了。
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
});
export type OutputDetail = z.infer<typeof OutputDetailSchema>;

// SEOUpdateInput —— PATCH /wiki/{id}/seo + /output/{id}/seo 入参。地址树派生,
// owner 不设 path —— 只有 description/indexed。
export interface SEOUpdateInput {
  excerpt: string;
  published: boolean;
}

export interface CorpusActionsHook {
  pending: boolean;
  error: string | null;
  // raw
  updateRaw: (id: string, input: RawUpdateInput) => Promise<boolean>;
  deleteRaw: (id: string) => Promise<boolean>;
  promoteRaw: (id: string, input: PromoteInput) => Promise<boolean>;
  // fetchRawDetail —— raw 的行内编辑框展开时拉 hero 三件套。列表行不带它们
  // (每行算一次素材太贵),而**表单不显示一个已经存在的值,等于告诉 owner "没设过"**。
  fetchRawDetail: (id: string) => Promise<RawDetail | null>;
  // subjectivity —— 跟 wiki / output 同形(它不是特例,只是第四个 genre)
  createSubjectivity: (input: CorpusEntryInput) => Promise<boolean>;
  updateSubjectivity: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  fetchSubjectivityDetail: (id: string) => Promise<SubjectivityDetail | null>;
  // wiki
  createWiki: (input: CorpusEntryInput) => Promise<boolean>;
  updateWiki: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  deleteWiki: (id: string) => Promise<boolean>;
  promoteWiki: (id: string, input: PromoteInput) => Promise<boolean>;
  fetchWikiDetail: (id: string) => Promise<WikiDetail | null>;
  updateWikiSEO: (id: string, input: SEOUpdateInput) => Promise<boolean>;
  // output
  createOutput: (input: CorpusEntryInput) => Promise<boolean>;
  updateOutput: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  deleteOutput: (id: string) => Promise<boolean>;
  fetchOutputDetail: (id: string) => Promise<OutputDetail | null>;
  updateOutputSEO: (id: string, input: SEOUpdateInput) => Promise<boolean>;
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
    deleteRaw: useCallback(
      (id) => run(() => doDeleteRaw(id)), [run]),
    promoteRaw: useCallback(
      (id, input) => run(() => doPromoteRaw(id, input)), [run]),
    fetchRawDetail: useCallback(
      (id: string) => fetchDetail(
        `/corpus/raw/${id}`, RawDetailSchema, setError, setPending), []),
    createSubjectivity: useCallback(
      (input) => run(() => doCreateSubjectivity(input)), [run]),
    updateSubjectivity: useCallback(
      (id, input) => run(() => doUpdateSubjectivity(id, input)), [run]),
    fetchSubjectivityDetail: useCallback(
      (id: string) => fetchDetail(
        `/corpus/subjectivity/${id}`, SubjectivityDetailSchema, setError, setPending), []),
    createWiki: useCallback(
      (input) => run(() => doCreateWiki(input)), [run]),
    updateWiki: useCallback(
      (id, input) => run(() => doUpdateWiki(id, input)), [run]),
    deleteWiki: useCallback(
      (id) => run(() => doDeleteWiki(id)), [run]),
    promoteWiki: useCallback(
      (id, input) => run(() => doPromoteWiki(id, input)), [run]),
    fetchWikiDetail: useCallback(
      (id: string) => fetchDetail(`/corpus/wiki/${id}`, WikiDetailSchema, setError, setPending), []),
    updateWikiSEO: useCallback(
      (id, input) => run(() => doUpdateWikiSEO(id, input)), [run]),
    createOutput: useCallback(
      (input) => run(() => doCreateOutput(input)), [run]),
    updateOutput: useCallback(
      (id, input) => run(() => doUpdateOutput(id, input)), [run]),
    deleteOutput: useCallback(
      (id) => run(() => doDeleteOutput(id)), [run]),
    fetchOutputDetail: useCallback(
      (id: string) => fetchDetail(`/corpus/output/${id}`, OutputDetailSchema, setError, setPending), []),
    updateOutputSEO: useCallback(
      (id, input) => run(() => doUpdateOutputSEO(id, input)), [run]),
    clearError: useCallback(() => setError(null), []),
  };
}

async function fetchDetail<T>(
  path: string,
  schema: z.ZodType<T>,
  setError: (m: string | null) => void,
  setPending: (b: boolean) => void,
): Promise<T | null> {
  setPending(true);
  setError(null);
  try {
    return await adminAPI.get(path, schema);
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
      onCorpusChanged(); // 树 + 计数一起作废,见 corpus-changed.ts(F-L-16)
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

// heroPatch —— hero 三项在后端是**指针字段**:不发 = 不动。owner 这次没碰的那几项
// 就别发 —— 发空串等于"明确清空",会把他上次设的抹掉。
function heroPatch(input: RawUpdateInput): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.cover_image_asset_id !== undefined) {
    out['cover_image_asset_id'] = input.cover_image_asset_id;
  }
  if (input.cover_headline !== undefined) out['cover_headline'] = input.cover_headline;
  if (input.cover_hue !== undefined) out['cover_hue'] = input.cover_hue;
  return out;
}

async function doUpdateRaw(id: string, input: RawUpdateInput): Promise<void> {
  const updated = await adminAPI.patch(`/corpus/raw/${id}`, {
    body: input.body, tags: input.tags ?? [],
    flagged_private: input.flagged_private ?? false,
    // hero 是**指针字段**:不发 = 不动。owner 这次没点封面就别发 —— 发空串等于
    // "明确清空",会把他上次设的封面抹掉。
    ...heroPatch(input),
  }, RawAdminViewSchema);
  rawStore.getState().mutate(
    (prev) => (prev ?? []).map((r) => r.id === id ? updated : r),
  );
}

// doDeleteRaw —— 删一条 raw。**从列表里拿掉**,不是打个已归档的标记留在那儿:
// 后端现在是真删(跟 wiki / output 一样),再刷新它也不会回来。
async function doDeleteRaw(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/corpus/raw/${id}`);
  rawStore.getState().mutate((prev) => (prev ?? []).filter((r) => r.id !== id));
}

async function doPromoteRaw(id: string, input: PromoteInput): Promise<void> {
  await adminAPI.postVoid(`/corpus/raw/${id}/promote`, input);
  // raw row 没有 promoted_to 字段在前端 view 里；只 refresh 让后端的状态回灌。
  rawStore.getState().reset();
  wikiStore.getState().reset();
}

// ─── wiki ───────────────────────────────────────────────────

// ─── subjectivity ───────────────────────────────────────────
//
// 跟 wiki / output 逐字同形 —— 同一条 `/corpus/{genre}` 路由、同一份入参。
// **这里没有一处 genre 特判**:它不是特例,只是第四个 genre。

async function doCreateSubjectivity(input: CorpusEntryInput): Promise<void> {
  const created = await adminAPI.post(
    '/corpus/subjectivity', input, SubjectivitySummarySchema);
  subjectivityStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
}

async function doUpdateSubjectivity(id: string, input: CorpusEntryInput): Promise<void> {
  const updated = await adminAPI.patch(
    `/corpus/subjectivity/${id}`, input, SubjectivitySummarySchema);
  subjectivityStore.getState().mutate(
    (prev) => (prev ?? []).map((n) => n.id === id ? updated : n),
  );
}

async function doCreateWiki(input: CorpusEntryInput): Promise<void> {
  const created = await adminAPI.post('/corpus/wiki', input, WikiSummarySchema);
  wikiStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
}

async function doUpdateWiki(id: string, input: CorpusEntryInput): Promise<void> {
  const updated = await adminAPI.patch(`/corpus/wiki/${id}`, input, WikiSummarySchema);
  wikiStore.getState().mutate(
    (prev) => (prev ?? []).map((w) => w.id === id ? updated : w),
  );
}

async function doDeleteWiki(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/corpus/wiki/${id}`);
  wikiStore.getState().mutate((prev) => (prev ?? []).filter((w) => w.id !== id));
}

async function doPromoteWiki(id: string, input: PromoteInput): Promise<void> {
  await adminAPI.postVoid(`/corpus/wiki/${id}/promote`, input);
  outputStore.getState().reset();
}

async function doUpdateWikiSEO(id: string, input: SEOUpdateInput): Promise<void> {
  await adminAPI.patchVoid(`/corpus/wiki/${id}/seo`, input);
  wikiStore.getState().reset();
}

// ─── output ─────────────────────────────────────────────────

async function doCreateOutput(input: CorpusEntryInput): Promise<void> {
  const created = await adminAPI.post('/corpus/output', input, OutputSummarySchema);
  outputStore.getState().mutate((prev) => [created, ...(prev ?? [])]);
}

async function doUpdateOutput(id: string, input: CorpusEntryInput): Promise<void> {
  const updated = await adminAPI.patch(`/corpus/output/${id}`, input, OutputSummarySchema);
  outputStore.getState().mutate(
    (prev) => (prev ?? []).map((o) => o.id === id ? updated : o),
  );
}

async function doDeleteOutput(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/corpus/output/${id}`);
  outputStore.getState().mutate((prev) => (prev ?? []).filter((o) => o.id !== id));
}

async function doUpdateOutputSEO(id: string, input: SEOUpdateInput): Promise<void> {
  await adminAPI.patchVoid(`/corpus/output/${id}/seo`, input);
  outputStore.getState().reset();
}
