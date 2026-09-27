// use-wiki —— /admin/wiki state: corpus.list for the wiki genre, one page at a time
// (docs/design/paging.md). The tag chip is a page param: the server filters before the LIMIT, so a
// tag reaches entries on every page (F-L-23).

'use client';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';

export const WikiSummarySchema = z.object({
  id: z.string(), title: z.string(), excerpt: z.string(),
  preview: z.string().optional(), tags: z.array(z.string()),
  source_raw_ids: z.array(z.string()), created_at: z.string(),
  parent_id: z.string().nullable().optional(), path: z.string().nullable().optional(),
  show_as_source: z.boolean(), published: z.boolean(),
  // tree view only: this node can be drilled into (lazy layer).
  has_children: z.boolean().optional(),
  // descendants —— how many entries a delete takes along, counted by the server (F-L-24).
  descendants: z.number().optional().default(0),
});
export type WikiSummary = z.infer<typeof WikiSummarySchema>;

// loadWikiTreeChildren —— one lazy layer of the wiki tree (empty parent = roots).
export function loadWikiTreeChildren(parentID: string): Promise<WikiSummary[]> {
  const qs = parentID ? `?parent=${encodeURIComponent(parentID)}` : '';
  return adminAPI.get(`/corpus/wiki/tree${qs}`, z.array(WikiSummarySchema));
}

export type WikiBodyState = 'loading' | 'error' | 'empty' | 'list';

export type WikiHook = PagedState<WikiSummary>;

export const wikiPage = createPagedStore({
  name: 'wiki', path: '/corpus/wiki', item: WikiSummarySchema, params: { tag: '' },
});

export function useWiki(): WikiHook {
  return usePaged(wikiPage);
}

// activeTagOf —— the tag chip the list is filtered by (null = none).
export function activeTagOf(page: WikiHook): string | null {
  return (page.params.tag ?? '') === '' ? null : (page.params.tag ?? null);
}

// pickWikiBodyState —— "empty" only when the genre is empty: with a tag chosen, an empty page is
// the tag's answer, not "you have no wiki yet".
export function pickWikiBodyState(hook: WikiHook): WikiBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.items.length === 0 && activeTagOf(hook) === null ? 'empty' : 'list';
}
