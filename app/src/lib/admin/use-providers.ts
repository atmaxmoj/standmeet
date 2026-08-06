// use-providers —— owner 的 provider 本子(/admin/providers)。
//
// 一个 owner 一本,其中一条是**默认**。码和 role 各自可以指一条,解析顺序
// `byoai > code > role > 默认`。删掉被引用的一条不需要先解绑 —— 引用置空,读时退默认;
// 默认那条删不动(后端回 409),这里不预判,让那句人话从后端来。
//
// key 只进不出:create 带明文 key,列表里只有 key_configured。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const ProviderViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  endpoint: z.string(),
  model: z.string(),
  key_configured: z.boolean(),
  is_default: z.boolean(),
  // gas_tokens —— 这条油箱还剩多少 token;null = 不计量(#7)。
  gas_tokens: z.number().nullable(),
});
export type ProviderView = z.infer<typeof ProviderViewSchema>;

export interface CreateProviderInput {
  label: string;
  provider: string;
  endpoint: string;
  model: string;
  key: string;
  is_default?: boolean;
}

export interface ProvidersHook {
  status: ResourceStatus;
  providers: readonly ProviderView[];
  error: string | null;
  refresh: () => Promise<void>;
  createProvider: (input: CreateProviderInput) => Promise<ProviderView>;
  setDefaultProvider: (id: string) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setGas: (id: string, tokens: number | null) => Promise<void>;
}

export const providersStore = createResourceStore<ProviderView[]>({
  name: 'providers',
  fetcher: () => adminAPI.get('/providers/', z.array(ProviderViewSchema)),
});

export function useProviders(): ProvidersHook {
  const r = useResource(providersStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    providers: r.data ?? [],
    error: r.error,
    refresh: providersStore.getState().refresh,
    createProvider,
    setDefaultProvider,
    deleteProvider,
    setGas,
  };
}

// mutation 抛错:调用方用 useAction 收尾(成功 toast / 失败 report)。

async function createProvider(input: CreateProviderInput): Promise<ProviderView> {
  const created = await adminAPI.post('/providers/', input, ProviderViewSchema);
  // 建的这条如果成了默认,原来那条就不再是了 —— 本地一起改,免得列表上出现两个默认。
  providersStore.getState().mutate((prev) =>
    [...clearDefaultIf(created.is_default, prev ?? []), created]);
  return created;
}

// setDefaultProvider —— 后端回的是 {ok:true},不是那一行;所以本地自己搬旗子。
async function setDefaultProvider(id: string): Promise<void> {
  await adminAPI.postVoid(`/providers/${id}/default`, {});
  providersStore.getState().mutate((prev) =>
    (prev ?? []).map((p) => ({ ...p, is_default: p.id === id })));
}

async function deleteProvider(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/providers/${id}`);
  providersStore.getState().mutate((prev) => (prev ?? []).filter((p) => p.id !== id));
}

// setGas —— 加油 / 拆表。null = 不计量(把这条油箱上的表拆了)。
async function setGas(id: string, tokens: number | null): Promise<void> {
  const updated = await adminAPI.patch(
    `/providers/${id}`, { gas_tokens: tokens }, ProviderViewSchema,
  );
  providersStore.getState().mutate((prev) =>
    (prev ?? []).map((p) => p.id === updated.id ? updated : p));
}

function clearDefaultIf(
  moved: boolean, rows: readonly ProviderView[],
): ProviderView[] {
  return moved ? rows.map((p) => ({ ...p, is_default: false })) : [...rows];
}
