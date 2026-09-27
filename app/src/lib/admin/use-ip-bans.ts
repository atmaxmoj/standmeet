// use-ip-bans —— /admin/ip-bans state store + ban/unban actions (#58-5).
// Shaped after use-prompts (zustand resource store + create/delete). Backend
// GET/POST/DELETE /api/admin/ip-bans; once banned, the public surface returns
// 403 to that IP across the board.

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';
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
  page: PagedState<BanView>;
  banIP: (input: BanInput) => Promise<void>;
  unbanIP: (id: string) => Promise<void>;
}

// ipBansPage —— one page at a time, newest first (docs/design/paging.md).
export const ipBansPage = createPagedStore({ name: 'ip-bans', path: '/ip-bans/', item: BanViewSchema });

export function useIPBans(): IPBansHook {
  const page = usePaged(ipBansPage);
  return {
    status: page.status,
    bans: page.items,
    error: page.error,
    page,
    banIP,
    unbanIP,
  };
}

// The mutation throws (no longer swallowed into false/null): the caller finishes
// up with useAction (success toast / failure report).
// This is a SECURITY action — a silent failure would leave an abuser free to
// keep going, so surfacing the failure is the whole point.
// A ban is an upsert (re-banning the same IP overwrites the row), so both mutations re-read the
// list rather than guess where the row now sits.
async function banIP(input: BanInput): Promise<void> {
  await adminAPI.post('/ip-bans/', { ip: input.ip, reason: input.reason }, BanViewSchema);
  await ipBansPage.getState().reload();
}

async function unbanIP(id: string): Promise<void> {
  await adminAPI.deleteVoid(`/ip-bans/${id}`);
  await ipBansPage.getState().reload();
}
