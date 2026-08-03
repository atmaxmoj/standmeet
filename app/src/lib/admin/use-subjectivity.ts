// use-subjectivity —— 面板上的自我模型列表(只读)。
//
// 这个 genre 的写口是 MCP(subjectivity_write:owner 跟自己的 AI 边想边写),所以这里
// **只有读**。在它之前 subjectivity 在面板上一个界面都没有 —— owner 想知道自己写过什么,
// 只能去问 AI。

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

// pickState —— 渲染哪一支。**空列表和还没加载完是两回事**:两者都"没有行",
// 但一个该显示骨架、另一个该显示"还什么都没有"。混成一个的话,加载中的那一瞬
// owner 看到的是"你还没写过任何东西"。
function pickState(status: string, count: number): SubjectivityHook['state'] {
  if (status === 'error') return 'error';
  if (status !== 'ready') return 'loading';
  return count === 0 ? 'empty' : 'list';
}
