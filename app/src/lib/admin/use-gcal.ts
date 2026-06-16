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
import { createResourceStore, readResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// ─── status ────────────────────────────────────────────────────

export const GCalStatusSchema = z.object({
  has_credentials: z.boolean(),
  connected: z.boolean(),
  calendar_id: z.string().optional(),
  scopes: z.array(z.string()).optional(),
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
  saveCredentials: (clientID: string, clientSecret: string) => Promise<boolean>;
  authorize: () => Promise<boolean>;
  disconnect: () => Promise<boolean>;
  savePolicy: (patch: Partial<BookingPolicy>) => Promise<boolean>;
}

export function useGCal(): GCalHook {
  const sRes = readResource(gcalStatusStore);
  const pRes = readResource(policyStore);
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

async function saveCredentials(
  clientID: string, clientSecret: string,
): Promise<boolean> {
  try {
    await adminAPI.postVoid('/connectors/google-calendar/credentials', {
      client_id: clientID, client_secret: clientSecret,
    });
    await gcalStatusStore.getState().refresh();
    return true;
  } catch {
    return false;
  }
}

const InitResultSchema = z.object({ auth_url: z.string(), state: z.string() });

async function authorize(): Promise<boolean> {
  try {
    const init = await adminAPI.post(
      '/connectors/google-calendar/init', {}, InitResultSchema,
    );
    // open consent in a new tab; on success Google redirects to the
    // callback URL which finishes the exchange server-side.
    window.open(init.auth_url, '_blank', 'noopener');
    // Poll status a couple of times until backend flips to connected.
    await pollUntilConnected(15);
    return true;
  } catch {
    return false;
  }
}

async function pollUntilConnected(maxAttempts: number): Promise<void> {
  for (let i = 0; i < maxAttempts; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    await gcalStatusStore.getState().refresh();
    if (gcalStatusStore.getState().data?.connected) return;
  }
}

async function disconnect(): Promise<boolean> {
  try {
    await adminAPI.postVoid('/connectors/google-calendar/disconnect', {});
    await gcalStatusStore.getState().refresh();
    return true;
  } catch {
    return false;
  }
}

async function savePolicy(patch: Partial<BookingPolicy>): Promise<boolean> {
  try {
    await adminAPI.patchVoid('/booking-policy', patch);
    await policyStore.getState().refresh();
    return true;
  } catch {
    return false;
  }
}
