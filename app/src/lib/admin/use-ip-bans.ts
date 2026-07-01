// use-ip-bans —— /admin/ip-bans 状态 store + ban/unban actions（#58-5）。形态
// 参照 use-prompts（zustand resource store + create/delete）。后端 GET/POST/
// DELETE /api/admin/ip-bans；封禁后公开面对该 IP 一律 403。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export const BanViewSchema = z.object({
  id: z.string(),
  ip: z.string(),
  reason: z.string(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
export type BanView = z.infer<typeof BanViewSchema>;

export interface BanInput {
  ip: string;
  reason: string;
}

export interface IPBansHook {
  status: ResourceStatus;
  bans: readonly BanView[];
  error: string | null;
  banIP: (input: BanInput) => Promise<void>;
  unbanIP: (id: string) => Promise<void>;
}

export const ipBansStore = createResourceStore<BanView[]>({
  name: 'ip-bans',
  fetcher: () => adminAPI.get('/ip-bans/', z.array(BanViewSchema)),
});

export function useIPBans(): IPBansHook {
  const r = readResource(ipBansStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  return {
    status: r.status,
    bans: r.data ?? [],
    error: r.error,
    banIP,
    unbanIP,
  };
}

// mutation 抛错（不再吞成 false/null）：调用方用 useAction 收尾（成功 toast / 失败 report）。
// 这是 SECURITY 动作 —— 静默失败会让滥用者继续畅通，所以反显是重点。
async function banIP(input: BanInput): Promise<void> {
  const created = await adminAPI.post(
    '/ip-bans/', { ip: input.ip, reason: input.reason }, BanViewSchema,
  );
  ipBansStore.getState().mutate((prev) => upsertByIP(prev ?? [], created));
}

async function unbanIP(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/ip-bans/${id}`);
  ipBansStore.getState().mutate((prev) => (prev ?? []).filter((b) => b.id !== id));
}

// upsertByIP —— ban 是 upsert（同 IP 重封覆盖），列表也按 IP 去重，新的置顶。
function upsertByIP(prev: readonly BanView[], b: BanView): BanView[] {
  return [b, ...prev.filter((x) => x.ip !== b.ip)];
}
