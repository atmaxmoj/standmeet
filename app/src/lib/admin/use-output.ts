// use-output —— /admin/output state: corpus.list for the output genre, one page at a time
// (docs/design/paging.md). The header counts the server's total, never the loaded rows.

'use client';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';

export const OutputSummarySchema = z.object({
  id: z.string(), title: z.string(), tags: z.array(z.string()),
  source_wiki_ids: z.array(z.string()), created_at: z.string(),
  parent_id: z.string().nullable().optional(), path: z.string().nullable().optional(),
  show_as_source: z.boolean(), published: z.boolean(),
  has_children: z.boolean().optional(),
  descendants: z.number().optional().default(0),
});
export type OutputSummary = z.infer<typeof OutputSummarySchema>;

// loadOutputTreeChildren —— one lazy layer of the output tree (empty parent = roots).
export function loadOutputTreeChildren(parentID: string): Promise<OutputSummary[]> {
  const qs = parentID ? `?parent=${encodeURIComponent(parentID)}` : '';
  return adminAPI.get(`/corpus/output/tree${qs}`, z.array(OutputSummarySchema));
}

export type OutputBodyState = 'loading' | 'error' | 'empty' | 'list';

export type OutputHook = PagedState<OutputSummary>;

export const outputPage = createPagedStore({
  name: 'output', path: '/corpus/output', item: OutputSummarySchema,
});

export function useOutput(): OutputHook {
  return usePaged(outputPage);
}

export function pickOutputBodyState(hook: OutputHook): OutputBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.items.length === 0 ? 'empty' : 'list';
}
