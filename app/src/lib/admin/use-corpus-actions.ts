// use-corpus-actions —— the update / delete / create / promote actions hook
// for the three tiers raw / wiki / output.
//
// Each action returns Promise<boolean> (true on success, false on failure
// with setError). The caller handles the toast; list stores reset() after a
// mutation → refetched on the next visit.

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
  // the hero trio — image + the line laid over it + tone. Backend pointer fields: not sending = leave unchanged, sending empty = clear it.
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
  // the hero trio — which asset for the image + the line laid over it + tone. Backend pointer fields: not sending = leave unchanged.
  cover_image_asset_id?: string;
  cover_headline?: string;
  cover_hue?: string;
}

export interface PromoteInput {
  title: string;
  tags?: string[];
  parent_id?: string;
}

// The detail view (returned by GET single) — has body + source_*_ids + SEO
// on top of the list summary; EditForm fetches it when expanding to backfill
// the body field.
// detail carries no path: the address is derived from the tree (the
// browse-list row has it computed and echoed by the backend), and the edit
// form has no path field.
const WikiDetailSchema = z.object({
  id: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()),
  source_raw_ids: z.array(z.string()),
  parent_id: z.string().nullable().optional(),
  show_as_source: z.boolean(), excerpt: z.string(), published: z.boolean(),
  // The hero image. omitempty: the field is absent when no cover was ever set — that's "none", not broken.
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
});
export type WikiDetail = z.infer<typeof WikiDetailSchema>;

// The detail for raw — only for the hero trio. raw's inline edit box uses
// the list row directly for its other fields (it carries body), but hero
// isn't in the list (computing assets for every row would be too expensive).
const RawDetailSchema = z.object({
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
});
export type RawDetail = z.infer<typeof RawDetailSchema>;

// subjectivity's detail. It has no excerpt / published (those concepts only
// exist for public-facing publishing); everything else matches wiki — a field that doesn't apply shouldn't be forced in.
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
  // The hero image. omitempty: the field is absent when no cover was ever set — that's "none", not broken.
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
});
export type OutputDetail = z.infer<typeof OutputDetailSchema>;

// SEOUpdateInput —— the input for PATCH /wiki/{id}/seo + /output/{id}/seo.
// The address is derived from the tree; the owner never sets path — only description/indexed.
export interface SEOUpdateInput {
  excerpt: string;
  published: boolean;
}

// SEOWriteResultSchema —— what this save did **as a side effect**.
// Unpublishing a pinned entry removes it from the homepage sections (the
// other end of that invariant, see `owner/entity/page_content.go`); the
// backend has always been saying so in the receipt, and the client used to
// discard the whole response via `patchVoid` — so one owner click did two
// things and only the first one was ever reported (F-L-31).
const SEOWriteResultSchema = z.object({
  unpinned_sections: z.array(z.string()).nullish().transform((v) => v ?? []),
});
export type SEOWriteResult = z.infer<typeof SEOWriteResultSchema>;

export interface CorpusActionsHook {
  pending: boolean;
  error: string | null;
  // raw
  updateRaw: (id: string, input: RawUpdateInput) => Promise<boolean>;
  deleteRaw: (id: string) => Promise<boolean>;
  promoteRaw: (id: string, input: PromoteInput) => Promise<boolean>;
  // fetchRawDetail —— fetches the hero trio when raw's inline edit box
  // expands. List rows don't carry them (computing assets per row would be
  // too expensive), and **a form that doesn't show an existing value is
  // telling the owner "never set"**.
  fetchRawDetail: (id: string) => Promise<RawDetail | null>;
  // subjectivity —— shaped the same as wiki / output (it's not a special case, just the fourth genre)
  createSubjectivity: (input: CorpusEntryInput) => Promise<boolean>;
  updateSubjectivity: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  fetchSubjectivityDetail: (id: string) => Promise<SubjectivityDetail | null>;
  // wiki
  createWiki: (input: CorpusEntryInput) => Promise<boolean>;
  updateWiki: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  deleteWiki: (id: string) => Promise<boolean>;
  promoteWiki: (id: string, input: PromoteInput) => Promise<boolean>;
  fetchWikiDetail: (id: string) => Promise<WikiDetail | null>;
  // updateWikiSEO / updateOutputSEO —— carries the receipt out
  // (`unpinned_sections`), so the caller can state what this save did **as a
  // side effect**. Failure is null.
  updateWikiSEO: (id: string, input: SEOUpdateInput) => Promise<SEOWriteResult | null>;
  // output
  createOutput: (input: CorpusEntryInput) => Promise<boolean>;
  updateOutput: (id: string, input: CorpusEntryInput) => Promise<boolean>;
  deleteOutput: (id: string) => Promise<boolean>;
  fetchOutputDetail: (id: string) => Promise<OutputDetail | null>;
  updateOutputSEO: (id: string, input: SEOUpdateInput) => Promise<SEOWriteResult | null>;
  clearError: () => void;
}

export function useCorpusActions(): CorpusActionsHook {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = makeRun(setPending, setError);
  const runValue = makeRunValue(setPending, setError);
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
      (id, input) => runValue(() => doUpdateWikiSEO(id, input)), [runValue]),
    createOutput: useCallback(
      (input) => run(() => doCreateOutput(input)), [run]),
    updateOutput: useCallback(
      (id, input) => run(() => doUpdateOutput(id, input)), [run]),
    deleteOutput: useCallback(
      (id) => run(() => doDeleteOutput(id)), [run]),
    fetchOutputDetail: useCallback(
      (id: string) => fetchDetail(`/corpus/output/${id}`, OutputDetailSchema, setError, setPending), []),
    updateOutputSEO: useCallback(
      (id, input) => runValue(() => doUpdateOutputSEO(id, input)), [runValue]),
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
// ValueRunner —— the same pending/error/invalidation handling as Runner,
// except it **hands out the write's receipt** instead of folding it into a
// boolean. Some writes do something else as a side effect (unpublishing
// unpins from the homepage), and only the response can say what that was;
// folded into a boolean, the caller can only report a generic "saved" (F-L-31). Failure is still null.
type ValueRunner = <T>(fn: () => Promise<T>) => Promise<T | null>;

function makeRun(
  setPending: (b: boolean) => void, setError: (m: string | null) => void,
): Runner {
  const runValue = makeRunValue(setPending, setError);
  return async (fn) => await runValue(fn) !== null;
}

function makeRunValue(
  setPending: (b: boolean) => void, setError: (m: string | null) => void,
): ValueRunner {
  return async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setPending(true);
    setError(null);
    try {
      const out = await fn();
      onCorpusChanged(); // invalidates the tree + counts together, see corpus-changed.ts (F-L-16)
      return out;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
      return null;
    } finally {
      setPending(false);
    }
  };
}

// ─── raw ────────────────────────────────────────────────────

// heroPatch —— the three hero fields are **pointer fields** on the backend:
// not sending = leave unchanged. Fields the owner didn't touch this time
// must not be sent — sending an empty string means "explicitly clear", which would wipe out what he set last time.
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
    // hero fields are **pointer fields**: not sending = leave unchanged. If
    // the owner didn't touch the cover this time, don't send it — an empty
    // string means "explicitly clear", which would wipe out the cover he set last time.
    ...heroPatch(input),
  }, RawAdminViewSchema);
  rawStore.getState().mutate(
    (prev) => (prev ?? []).map((r) => r.id === id ? updated : r),
  );
}

// doDeleteRaw —— deletes one raw entry. **Removed from the list**, not left
// there with an archived flag: the backend now genuinely deletes it (same as
// wiki / output), and it won't come back even on refresh.
async function doDeleteRaw(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/corpus/raw/${id}`);
  rawStore.getState().mutate((prev) => (prev ?? []).filter((r) => r.id !== id));
}

async function doPromoteRaw(id: string, input: PromoteInput): Promise<void> {
  await adminAPI.postVoid(`/corpus/raw/${id}/promote`, input);
  // The raw row has no promoted_to field in the frontend view; just refresh to pull the backend's state back in.
  rawStore.getState().reset();
  wikiStore.getState().reset();
}

// ─── wiki ───────────────────────────────────────────────────

// ─── subjectivity ───────────────────────────────────────────
//
// Byte-for-byte the same shape as wiki / output — the same `/corpus/{genre}`
// route, the same input. **Not a single genre special-case anywhere here**: it isn't an exception, just the fourth genre.

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

async function doUpdateWikiSEO(id: string, input: SEOUpdateInput): Promise<SEOWriteResult> {
  const res = await adminAPI.patch(`/corpus/wiki/${id}/seo`, input, SEOWriteResultSchema);
  wikiStore.getState().reset();
  return res;
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

async function doUpdateOutputSEO(id: string, input: SEOUpdateInput): Promise<SEOWriteResult> {
  const res = await adminAPI.patch(`/corpus/output/${id}/seo`, input, SEOWriteResultSchema);
  outputStore.getState().reset();
  return res;
}
