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
  // bound_codes —— 哪些码开这一页（绑定的另一头）。nullish 是为了不让旧后端把整份列表打挂
  // （[[zod-unknown-is-not-optional]]：服务端少发一个字段，客户端整份 schema 静默失败）。
  bound_codes: z.array(z.string()).nullish(),
  allow_byoai: z.boolean().nullish(),
  created_at: z.string(), updated_at: z.string(),
});
export type CustomPageSummary = z.infer<typeof CustomPageSummarySchema>;

const BuildSchema = z.object({
  build_id: z.string(), status: z.string(), error_message: z.string().nullish(),
});
export type BuildView = z.infer<typeof BuildSchema>;

export type CustomPagesBodyState = 'loading' | 'error' | 'empty' | 'list';

export interface CustomPagesHook {
  status: ResourceStatus;
  rows: readonly CustomPageSummary[];
  error: string | null;
  refresh: () => Promise<void>;
  createPage: (slug: string, title: string) => Promise<void>;
  writeFile: (slug: string, path: string, content: string) => Promise<void>;
  build: (slug: string) => Promise<BuildView>;
  getBuild: (buildID: string) => Promise<BuildView>;
  promote: (slug: string, buildID: string) => Promise<void>;
  setByoai: (slug: string, allow: boolean) => Promise<void>;
}

export const customPagesStore = createResourceStore<CustomPageSummary[]>({
  name: 'custom-pages',
  fetcher: () => adminAPI.get('/custom-pages', z.array(CustomPageSummarySchema)),
});

export function useCustomPages(): CustomPagesHook {
  const r = useResource(customPagesStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status, rows: r.data ?? [], error: r.error,
    refresh: customPagesStore.getState().refresh,
    createPage, writeFile, build, getBuild, promote, setByoai,
  };
}

// mutation 一律抛错，由调用方用 useAction 收尾（成功 toast / 失败 report）——
// 吞成 false 的话，「构建没跑起来」跟「构建跑了但失败」在屏幕上是同一件事。
async function createPage(slug: string, title: string): Promise<void> {
  await adminAPI.post('/custom-pages/', { slug, title }, z.object({ slug: z.string() }));
  await customPagesStore.getState().refresh();
}

async function writeFile(slug: string, path: string, content: string): Promise<void> {
  await adminAPI.put(`/custom-pages/${slug}/files`, { path, content }, z.object({}).passthrough());
}

async function build(slug: string): Promise<BuildView> {
  return adminAPI.post(`/custom-pages/${slug}/build`, {}, BuildSchema);
}

async function getBuild(buildID: string): Promise<BuildView> {
  return adminAPI.get(`/custom-pages/builds/${buildID}`, BuildSchema);
}

async function promote(slug: string, buildID: string): Promise<void> {
  await adminAPI.post(`/custom-pages/${slug}/live`, { build_id: buildID },
    z.object({}).passthrough());
  await customPagesStore.getState().refresh();
}

// publishPage —— 建 → 写 → 构建 → 轮询 → 成功才上线，整条序列。
//
// 放在这一层而不是组件里：**构建是异步的**，而「在跑 / 成了 / 失败了」的判定是逻辑不是呈现。
// onTick 把每一次轮询的结果交回去，因为 owner 要看的正是「它还在跑」——
// 一个点下去没反应的按钮，跟一次失败的构建在屏幕上是同一件事。
export async function publishPage(
  slug: string, source: string, onTick: (b: BuildView) => void,
): Promise<BuildView> {
  await createPage(slug, slug);
  await writeFile(slug, 'App.tsx', source);
  const started = await build(slug);
  onTick(started);
  const settled = await pollBuild(started.build_id, onTick);
  await promoteIfBuilt(slug, settled);
  return settled;
}

async function pollBuild(id: string, onTick: (b: BuildView) => void): Promise<BuildView> {
  for (;;) {
    await new Promise((r) => { setTimeout(r, POLL_MS); });
    const row = await getBuild(id);
    onTick(row);
    if (row.status === 'built' || row.status === 'failed') return row;
  }
}

// promoteIfBuilt —— 只有构建成功才上线。**失败不许动线上**：
// 一次失败的构建把已经在服务的页面换掉，是最坏的一种"成功"。
async function promoteIfBuilt(slug: string, settled: BuildView): Promise<void> {
  if (settled.status !== 'built') return;
  await promote(slug, settled.build_id);
}

const POLL_MS = 1500;

async function setByoai(slug: string, allow: boolean): Promise<void> {
  await adminAPI.put(`/custom-pages/${slug}/byoai`, { allow_byoai: allow },
    z.object({}).passthrough());
  await customPagesStore.getState().refresh();
}

export function pickCustomPagesBodyState(hook: CustomPagesHook): CustomPagesBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}
