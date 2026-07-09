// use-output —— /admin/output 状态。GET /api/admin/corpus/output 返 list。

'use client';

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const OutputSummarySchema = z.object({
  id: z.string(), title: z.string(), tags: z.array(z.string()),
  source_wiki_ids: z.array(z.string()), created_at: z.string(),
  parent_id: z.string().nullable().optional(), path: z.string().nullable().optional(),
  show_as_source: z.boolean(), published: z.boolean(),
});
export type OutputSummary = z.infer<typeof OutputSummarySchema>;

export type OutputBodyState = 'loading' | 'error' | 'empty' | 'list';

export interface OutputHook {
  status: ResourceStatus;
  rows: readonly OutputSummary[];
  error: string | null;
}

export const outputStore = createResourceStore<OutputSummary[]>({
  name: 'output',
  fetcher: () => adminAPI.get('/corpus/output', z.array(OutputSummarySchema)),
});

export function useOutput(): OutputHook {
  const r = readResource(outputStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { status: r.status, rows: r.data ?? [], error: r.error };
}

export function pickOutputBodyState(hook: OutputHook): OutputBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}
