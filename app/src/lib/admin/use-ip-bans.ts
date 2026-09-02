// use-ip-bans —— /admin/ip-bans state store + ban/unban actions (#58-5).
// Shaped after use-prompts (zustand resource store + create/delete). Backend
// GET/POST/DELETE /api/admin/ip-bans; once banned, the public surface returns
// 403 to that IP across the board.

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
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
  const r = useResource(ipBansStore);
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

// The mutation throws (no longer swallowed into false/null): the caller finishes
// up with useAction (success toast / failure report).
// This is a SECURITY action — a silent failure would leave an abuser free to
// keep going, so surfacing the failure is the whole point.
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

// upsertByIP —— a ban is an upsert (re-banning the same IP overwrites), the list dedupes by IP too, newest on top.
function upsertByIP(prev: readonly BanView[], b: BanView): BanView[] {
  return [b, ...prev.filter((x) => x.ip !== b.ip)];
}
