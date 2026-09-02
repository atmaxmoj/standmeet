// use-gcal —— state + actions for /admin/connectors Calendar panel.
//
// Three blocks of state:
//   1. connector status (has_credentials / connected / scopes)
//   2. booking policy (working hours / weekdays / lead time / timezone)
//   3. credentials form (client_id / client_secret, saved on blur)
//
// Every mutation syncs immediately into the zustand store; the component reads the store directly.

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

// toggledWeekdays —— add/remove one weekday. Branching moved to lib so the presentation layer has no if.
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

// The booking policy is config that the booker capability **declares for
// itself**, read and written through the generic capability-config endpoint;
// the backend no longer has a /booking-policy hardcoded to this capability's
// name. timezone is not part of it — that belongs to the owner's profile
// (another capability would also use it to interpret "what time"), and goes
// through /me + /account/timezone.
const BOOKER_CAP = 'calendar.book';

const CapConfigSchema = z.object({
  fields: z.array(z.object({ key: z.string(), value: z.unknown() })),
});

const MeTimezoneSchema = z.object({ owner: z.object({ timezone: z.string() }) });

async function fetchPolicy(): Promise<BookingPolicy> {
  const [cfg, me] = await Promise.all([
    adminAPI.get(`/capabilities/${BOOKER_CAP}/config`, CapConfigSchema),
    adminAPI.get('/me', MeTimezoneSchema),
  ]);
  const byKey: Record<string, unknown> = {};
  for (const f of cfg.fields) byKey[f.key] = f.value;
  return BookingPolicySchema.parse({ ...byKey, timezone: me.owner.timezone });
}

export const policyStore = createResourceStore<BookingPolicy>({
  name: 'gcal-policy',
  fetcher: fetchPolicy,
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

// The mutation throws (no longer swallowed into false): the auto-save call
// site uses `.catch(report)`, and an explicit button (disconnect) finishes up with useAction.
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
  const { timezone, ...fields } = patch;
  if (timezone !== undefined) {
    await adminAPI.patchVoid('/account/timezone', { timezone });
  }
  if (Object.keys(fields).length > 0) {
    await adminAPI.patchVoid(`/capabilities/${BOOKER_CAP}/config`, { values: fields });
  }
  await policyStore.getState().refresh();
}
