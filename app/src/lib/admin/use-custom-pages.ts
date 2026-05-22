// use-custom-pages —— /admin/custom-pages 状态。GET /api/admin/custom-pages 返 list。
//
// 只读视图 —— create / build / promote 等写操作走 MCP tool（owner 在 Claude
// 那侧驱动），admin UI 只显示状态 + 提供 "view live ↗" 链接让 owner 不开
// Claude 也能确认 / 访问 live 版本。

'use client';

import { useEffect } from 'react';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export interface CustomPageSummary {
  id: string;
  slug: string;
  title: string;
  status: string; // 'active' | 'archived' | 'deleted'
  has_live: boolean;
  has_staging: boolean;
  live_build_id?: string;
  created_at: string;
  updated_at: string;
}

export type CustomPagesBodyState = 'loading' | 'error' | 'empty' | 'list';

export interface CustomPagesHook {
  status: ResourceStatus;
  rows: readonly CustomPageSummary[];
  error: string | null;
}

export const customPagesStore = createResourceStore<CustomPageSummary[]>({
  name: 'custom-pages',
  fetcher: () => adminAPI.get<CustomPageSummary[]>('/custom-pages'),
});

export function useCustomPages(): CustomPagesHook {
  const r = readResource(customPagesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return { status: r.status, rows: r.data ?? [], error: r.error };
}

export function pickCustomPagesBodyState(hook: CustomPagesHook): CustomPagesBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}
