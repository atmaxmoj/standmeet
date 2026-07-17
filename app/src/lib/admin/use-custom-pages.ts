// use-custom-pages —— /admin/custom-pages 状态。

'use client';

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

const CustomPageSummarySchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), status: z.string(),
  has_live: z.boolean(), has_staging: z.boolean(), live_build_id: z.string().optional(),
  created_at: z.string(), updated_at: z.string(),
});
export type CustomPageSummary = z.infer<typeof CustomPageSummarySchema>;

export type CustomPagesBodyState = 'loading' | 'error' | 'empty' | 'list';

export interface CustomPagesHook {
  status: ResourceStatus;
  rows: readonly CustomPageSummary[];
  error: string | null;
}

export const customPagesStore = createResourceStore<CustomPageSummary[]>({
  name: 'custom-pages',
  fetcher: () => adminAPI.get('/custom-pages', z.array(CustomPageSummarySchema)),
});

export function useCustomPages(): CustomPagesHook {
  const r = useResource(customPagesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { status: r.status, rows: r.data ?? [], error: r.error };
}

export function pickCustomPagesBodyState(hook: CustomPagesHook): CustomPagesBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}
