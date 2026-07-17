// use-gcal —— state + actions for /admin/connectors Calendar panel.
//
// 三块状态：
//   1. connector status (has_credentials / connected / scopes)
//   2. booking policy (working hours / weekdays / lead time / timezone)
//   3. credentials form (client_id / client_secret，blur 后保存)
//
// 所有 mutation 立即同步到 zustand store；component 直接读 store。

import { useEffect } from 'react';

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// ─── status ────────────────────────────────────────────────────

export const GCalStatusSchema = z.object({
  has_credentials: z.boolean(),
  connected: z.boolean(),
  calendar_id: z.string().optional(),
  scopes: z.array(z.string()).nullish().transform((v) => v ?? undefined), // F-D-1 class: scopes can be null
});
export type GCalStatus = z.infer<typeof GCalStatusSchema>;

export const gcalStatusStore = createResourceStore<GCalStatus>({
  name: 'gcal-status',
  fetcher: () => adminAPI.get(
    '/connectors/google-calendar/status', GCalStatusSchema,
  ),
});

// ─── booking policy ────────────────────────────────────────────

export const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type WeekdayT = z.infer<typeof Weekday>;

// toggledWeekdays —— add/remove one weekday。分支挪 lib 让 presentation 层无 if。
export function toggledWeekdays(current: readonly WeekdayT[], d: WeekdayT): WeekdayT[] {
  if (current.includes(d)) return current.filter((x) => x !== d);
  return [...current, d];
}

export const BookingPolicySchema = z.object({
  min_lead_days: z.number(),
  allowed_weekdays: z.array(Weekday),
  working_hours_start: z.string(),
  working_hours_end: z.string(),
  buffer_min: z.number(),
  timezone: z.string(),
});
export type BookingPolicy = z.infer<typeof BookingPolicySchema>;

export const policyStore = createResourceStore<BookingPolicy>({
  name: 'gcal-policy',
  fetcher: () => adminAPI.get('/booking-policy', BookingPolicySchema),
});

// ─── hook ──────────────────────────────────────────────────────

export interface GCalHook {
  statusKind: ResourceStatus;
  status: GCalStatus | null;
  policyKind: ResourceStatus;
  policy: BookingPolicy | null;
  error: string | null;
  refresh: () => Promise<void>;
  saveCredentials: (clientID: string, clientSecret: string) => Promise<void>;
  authorize: () => Promise<void>;
  disconnect: () => Promise<void>;
  savePolicy: (patch: Partial<BookingPolicy>) => Promise<void>;
}

export function useGCal(): GCalHook {
  const sRes = useResource(gcalStatusStore);
  const pRes = useResource(policyStore);
  const ensureStatus = sRes.ensureLoaded;
  const ensurePolicy = pRes.ensureLoaded;
  useEffect(() => { void ensureStatus(); }, [ensureStatus]);
  useEffect(() => { void ensurePolicy(); }, [ensurePolicy]);
  return {
    statusKind: sRes.status,
    status: sRes.data ?? null,
    policyKind: pRes.status,
    policy: pRes.data ?? null,
    error: sRes.error ?? pRes.error,
    refresh,
    saveCredentials,
    authorize,
    disconnect,
    savePolicy,
  };
}

// ─── actions ───────────────────────────────────────────────────

async function refresh(): Promise<void> {
  await Promise.all([
    gcalStatusStore.getState().refresh(),
    policyStore.getState().refresh(),
  ]);
}

// mutation 抛错（不再吞成 false）：调用方 auto-save 路径用 `.catch(report)`，
// 显式按钮（disconnect）用 useAction 收尾。
async function saveCredentials(
  clientID: string, clientSecret: string,
): Promise<void> {
  await adminAPI.postVoid('/connectors/google-calendar/credentials', {
    client_id: clientID, client_secret: clientSecret,
  });
  await gcalStatusStore.getState().refresh();
}

// Mirrors the backend `connectInitResp` from POST /connectors/{id}/connect:
// auth_url + state are present for the OAuth dance; `connected` may already
// be true (creds re-exchanged) and `auth_url` omitted, so both are optional.
const InitResultSchema = z.object({
  auth_url: z.string().optional(),
  state: z.string().optional(),
  connected: z.boolean().optional(),
  error: z.string().optional(),
});

async function authorize(): Promise<void> {
  // The generic connector Connect endpoint returns the provider consent URL.
  // (There is no `/init` route — that path 404s; the backend serves `/connect`.)
  const init = await adminAPI.post(
    '/connectors/google-calendar/connect', {}, InitResultSchema,
  );
  // open consent in a new tab; on success Google redirects to the
  // callback URL which finishes the exchange server-side.
  if (init.auth_url) window.open(init.auth_url, '_blank', 'noopener');
  // Poll status a couple of times until backend flips to connected.
  await pollUntilConnected(15);
}

async function pollUntilConnected(maxAttempts: number): Promise<void> {
  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    await gcalStatusStore.getState().refresh();
    if (gcalStatusStore.getState().data?.connected) return;
  }
}

async function disconnect(): Promise<void> {
  await adminAPI.postVoid('/connectors/google-calendar/disconnect', {});
  await gcalStatusStore.getState().refresh();
}

async function savePolicy(patch: Partial<BookingPolicy>): Promise<void> {
  await adminAPI.patchVoid('/booking-policy', patch);
  await policyStore.getState().refresh();
}
