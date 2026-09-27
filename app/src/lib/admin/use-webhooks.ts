// use-webhooks —— /admin/webhooks state: the owner's endpoints, the event types they can pick, the
// one-time secret, and the open endpoint's delivery log (docs/design/event-bus-outbox-webhooks.md,
// *Webhook endpoints*).
//
// Every display decision is made here, not in the component (use-webhooks.test.ts checks them).

'use client';

import { useEffect } from 'react';
import { z } from 'zod';
import { create } from 'zustand';

import { adminAPI } from '@/lib/api/admin';
import { logger } from '@/lib/logger';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';
import { ago, stampMinute } from '@/lib/ui/format-time';

// Go marshals an empty slice as null; normalize once at the entrance.
function list<T extends z.ZodTypeAny>(item: T) {
  return z.array(item).nullish().transform((v) => v ?? []);
}

const EndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  description: z.string(),
  event_types: list(z.string()),
  enabled: z.boolean(),
  disabled_reason: z.string(),
  failing_since: z.string().nullish(),
  created_at: z.string(),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

const EventTypeSchema = z.object({ type: z.string(), description: z.string(), subject: z.string() });
export type EventType = z.infer<typeof EventTypeSchema>;

// state is a plain string: a new backend state must render, not blank the log.
const DeliverySchema = z.object({
  job_id: z.number(),
  state: z.string(),
  attempt: z.number(),
  event_id: z.string(),
  errors: list(z.object({ at: z.string(), error: z.string(), attempt: z.number() })),
  created_at: z.string(),
  finalized_at: z.string().nullish(),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const LOG_POLL_MS = 3_000;

const CreatedSchema = z.object({ endpoint: EndpointSchema, secret: z.string() });
const SecretSchema = z.object({ secret: z.string() });

const endpointsStore = createResourceStore<Endpoint[]>({
  name: 'webhooks',
  fetcher: () => adminAPI.get('/webhooks', z.object({ endpoints: list(EndpointSchema) }))
    .then((r) => r.endpoints),
});

const typesStore = createResourceStore<EventType[]>({
  name: 'webhook-event-types',
  fetcher: () => adminAPI.get('/webhooks/event_types', z.object({ event_types: list(EventTypeSchema) }))
    .then((r) => r.event_types),
});

interface WebhooksState {
  // secret —— shown once, right after create or rotate; cleared when the page is left.
  secret: string | null;
  open: string | null;
  deliveries: Delivery[];
  logStatus: ResourceStatus;
  create: (url: string, types: string[]) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  rotate: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  sendTest: (id: string) => Promise<void>;
  openLog: (id: string) => Promise<void>;
  pollLog: () => Promise<void>;
  redeliverAll: () => Promise<void>;
}

const refreshEndpoints = () => { void endpointsStore.getState().refresh(); };

const deliveriesOf = (id: string) => adminAPI
  .get(`/webhooks/${id}/deliveries`, z.object({ deliveries: list(DeliverySchema) }))
  .then((r) => r.deliveries);

// Mutations throw; the component wraps them in useAction so a refusal surfaces as a toast.
export const webhooksStore = create<WebhooksState>((set, get) => ({
  secret: null,
  open: null,
  deliveries: [],
  logStatus: 'idle',
  create: async (url, types) => {
    const r = await adminAPI.post('/webhooks', { url, event_types: types }, CreatedSchema);
    set({ secret: r.secret });
    refreshEndpoints();
  },
  setEnabled: async (id, enabled) => {
    await adminAPI.patch(`/webhooks/${id}`, { enabled }, z.object({ endpoint: EndpointSchema }));
    refreshEndpoints();
  },
  rotate: async (id) => {
    set({ secret: (await adminAPI.post(`/webhooks/${id}/rotate_secret`, {}, SecretSchema)).secret });
  },
  remove: async (id) => {
    await adminAPI.deleteVoid(`/webhooks/${id}`);
    get().open === id && set({ open: null, deliveries: [] });
    refreshEndpoints();
  },
  sendTest: async (id) => {
    await adminAPI.post(`/webhooks/${id}/test`, {}, z.object({ event_id: z.string() }));
    get().open === id && setTimeout(() => { void get().pollLog(); }, LOG_POLL_MS);
  },
  // openLog —— the previous log goes away at once; a late answer for another endpoint is dropped.
  openLog: async (id) => {
    set({ open: id, deliveries: [], logStatus: 'loading' });
    try {
      const deliveries = await deliveriesOf(id);
      get().open === id && set({ deliveries, logStatus: 'ready' });
    } catch (e) {
      get().open === id && set({ logStatus: 'error' });
      throw e;
    }
  },
  pollLog: async () => {
    const id = get().open;
    if (id === null) return;
    const deliveries = await deliveriesOf(id);
    get().open === id && set({ deliveries });
  },
  redeliverAll: async () => {
    const id = get().open;
    if (id === null) return;
    await adminAPI.post(`/webhooks/${id}/redeliver`, {}, z.object({ redelivered: z.number() }));
    await get().pollLog();
  },
}));

// useLogPolling —— while a log is open, re-read it so retries and redeliveries show without a reload.
function useLogPolling(open: string | null): void {
  useEffect(() => {
    if (open === null) return undefined;
    const timer = setInterval(() => {
      webhooksStore.getState().pollLog().catch((e: unknown) => {
        logger.warn('webhooks: delivery log poll failed; retrying next tick', e);
      });
    }, LOG_POLL_MS);
    return () => clearInterval(timer);
  }, [open]);
}

export interface WebhooksHook {
  endpoints: { status: ResourceStatus; data: Endpoint[] };
  types: EventType[];
  secret: string | null;
  open: string | null;
  deliveries: { status: ResourceStatus; data: Delivery[] };
  error: string | null;
}

export function useWebhooks(): WebhooksHook {
  const endpoints = useResource(endpointsStore);
  const types = useResource(typesStore);
  const secret = webhooksStore((s) => s.secret);
  const open = webhooksStore((s) => s.open);
  const deliveries = webhooksStore((s) => s.deliveries);
  const logStatus = webhooksStore((s) => s.logStatus);
  useEffect(() => {
    webhooksStore.setState({ secret: null, open: null, deliveries: [], logStatus: 'idle' });
    void endpointsStore.getState().refresh();
    void typesStore.getState().ensureLoaded();
  }, []);
  useLogPolling(open);
  return {
    endpoints: { status: endpoints.status, data: endpoints.data ?? [] },
    types: types.data ?? [],
    secret, open, deliveries: { status: logStatus, data: deliveries },
    error: endpoints.error ?? types.error,
  };
}

// ── pure view helpers (tested in use-webhooks.test.ts) ───────

export type EndpointStatus = 'on' | 'failing' | 'off';

export interface EndpointRowView {
  id: string;
  url: string;
  types: string;
  status: EndpointStatus;
  // reason —— why it is off (the backend's words), or since when it is failing.
  reason: string;
}

export function endpointRowView(e: Endpoint): EndpointRowView {
  const failing = e.failing_since ?? '';
  let status: EndpointStatus = 'on';
  let reason = '';
  if (!e.enabled) {
    status = 'off';
    reason = e.disabled_reason;
  } else if (failing !== '') {
    status = 'failing';
    reason = ago(failing);
  }
  return { id: e.id, url: e.url, types: e.event_types.join(', '), status, reason };
}

export interface DeliveryRowView {
  key: string;
  state: string;
  attempt: number;
  event: string;
  when: string;
  lastError: string;
  // jobHref —— the Tasks panel with this delivery's job opened.
  jobHref: string;
}

export function deliveryRowView(d: Delivery): DeliveryRowView {
  return {
    key: String(d.job_id),
    state: d.state,
    attempt: d.attempt,
    event: d.event_id,
    when: stampMinute(d.created_at),
    lastError: d.errors.at(-1)?.error ?? '',
    jobHref: `/admin/tasks?job=${d.job_id}`,
  };
}

// toggleType —— the picked event types after one checkbox changes, in a stable order.
export function toggleType(picked: readonly string[], type: string, on: boolean): string[] {
  const next = new Set(picked);
  if (on) next.add(type);
  else next.delete(type);
  return [...next].sort();
}
