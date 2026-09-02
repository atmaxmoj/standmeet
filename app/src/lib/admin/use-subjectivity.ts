// use-subjectivity —— the self-model list on the admin panel (read-only).
//
// This genre's write path is MCP (subjectivity_write: the owner writes it
// while thinking out loud with their own AI), so this side is **read-only**.
// Before this, subjectivity had no interface at all on the admin panel — the
// only way for the owner to find out what they'd written was to ask the AI.

'use client';

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';

export const SubjectivitySummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string().nullish().transform((v) => v ?? ''),
  tags: z.array(z.string()).nullish().transform((v) => v ?? []),
});
export type SubjectivityEntry = z.infer<typeof SubjectivitySummarySchema>;

export const subjectivityStore = createResourceStore<SubjectivityEntry[]>({
  name: 'subjectivity',
  fetcher: () => adminAPI.get('/corpus/subjectivity', z.array(SubjectivitySummarySchema)),
});

export interface SubjectivityHook {
  rows: readonly SubjectivityEntry[];
  error: string | null;
  status: string;
  state: 'loading' | 'error' | 'empty' | 'list';
}

export function useSubjectivity(): SubjectivityHook {
  const r = useResource(subjectivityStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  const rows = r.data ?? [];
  return { rows, error: r.error, status: r.status, state: pickState(r.status, rows.length) };
}

// pickState —— which branch to render. **An empty list and still-loading are
// two different things**: both have "no rows", but one should show a
// skeleton, the other "nothing here yet". Merge them into one and, for that
// moment while it's still loading, the owner sees "you haven't written
// anything yet".
function pickState(status: string, count: number): SubjectivityHook['state'] {
  if (status === 'error') return 'error';
  if (status !== 'ready') return 'loading';
  return count === 0 ? 'empty' : 'list';
}
