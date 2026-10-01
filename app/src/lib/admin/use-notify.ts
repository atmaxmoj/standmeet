// use-notify —— /admin/notify state: notification rules, the owner's linked chats (and the pairing
// code of one being linked), and what a rule can choose from: event types with their filterable
// keys, active codes, webhook endpoints (docs/design/notify-rules-and-live-transcript.md).
//
// Every display decision is made here, not in the component (use-notify.test.ts checks them).

'use client';

import { useEffect } from 'react';
import { z } from 'zod';
import { create } from 'zustand';

import { adminAPI } from '@/lib/api/admin';
import { logger } from '@/lib/logger';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

// Go marshals an empty slice as null; normalize once at the entrance.
function list<T extends z.ZodTypeAny>(item: T) {
  return z.array(item).nullish().transform((v) => v ?? []);
}

const RuleSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  filter_key: z.string(),
  filter_value: z.string(),
  first_only: z.boolean(),
  channel: z.string(),
  channel_ref: z.string(),
  template: z.string(),
  enabled: z.boolean(),
});
export type Rule = z.infer<typeof RuleSchema>;

const LinkSchema = z.object({
  id: z.string(), platform: z.string(), pairing_code: z.string(), linked: z.boolean(),
});
export type IMLink = z.infer<typeof LinkSchema>;

const TypeSchema = z.object({ type: z.string(), description: z.string(), filterable: list(z.string()) });
export type NotifyType = z.infer<typeof TypeSchema>;

const CodeSchema = z.object({ id: z.string(), code: z.string() });
export type CodeOption = z.infer<typeof CodeSchema>;
const EndpointSchema = z.object({ id: z.string(), url: z.string() });
export type EndpointOption = z.infer<typeof EndpointSchema>;

// LINK_POLL_MS —— while a chat waits for its pairing code, how often the list is re-read.
export const LINK_POLL_MS = 3_000;

const rulesStore = createResourceStore<Rule[]>({
  name: 'notify-rules',
  fetcher: () => adminAPI.get('/notify/rules', z.object({ rules: list(RuleSchema) })).then((r) => r.rules),
});
const linksStore = createResourceStore<IMLink[]>({
  name: 'notify-im',
  fetcher: () => adminAPI.get('/notify/im', z.object({ links: list(LinkSchema) })).then((r) => r.links),
});
const typesStore = createResourceStore<NotifyType[]>({
  name: 'notify-event-types',
  fetcher: () => adminAPI.get('/notify/event_types', z.object({ event_types: list(TypeSchema) }))
    .then((r) => r.event_types),
});
const codesStore = createResourceStore<CodeOption[]>({
  name: 'notify-codes',
  fetcher: () => adminAPI.get('/codes/?state=active', z.object({ items: list(CodeSchema) }))
    .then((r) => r.items),
});
const endpointsStore = createResourceStore<EndpointOption[]>({
  name: 'notify-endpoints',
  fetcher: () => adminAPI.get('/webhooks', z.object({ endpoints: list(EndpointSchema) }))
    .then((r) => r.endpoints),
});

// RuleDraft —— the form. channel is one value: 'email', 'im:<id>' or 'webhook:<id>'.
export interface RuleDraft {
  eventType: string;
  filterValue: string;
  firstOnly: boolean;
  channel: string;
  template: string;
}

export const EMPTY_DRAFT: RuleDraft = {
  eventType: '', filterValue: '', firstOnly: false, channel: 'email', template: '',
};

interface NotifyState {
  // pairing —— the code of the chat being linked right now (shown until it links).
  pairing: string | null;
  createRule: (d: RuleDraft, types: readonly NotifyType[]) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
  linkIM: () => Promise<void>;
  unlinkIM: (id: string) => Promise<void>;
}

// Mutations throw; the component wraps them in useAction so a refusal surfaces as a toast.
export const notifyStore = create<NotifyState>((set) => ({
  pairing: null,
  createRule: async (d, types) => {
    await adminAPI.post('/notify/rules', ruleBody(d, types), z.object({ rule: RuleSchema }));
    void rulesStore.getState().refresh();
  },
  setEnabled: async (id, enabled) => {
    await adminAPI.patch(`/notify/rules/${id}`, { enabled }, z.object({ rule: RuleSchema }));
    void rulesStore.getState().refresh();
  },
  removeRule: async (id) => {
    await adminAPI.deleteVoid(`/notify/rules/${id}`);
    void rulesStore.getState().refresh();
  },
  linkIM: async () => {
    const r = await adminAPI.post('/notify/im', {}, z.object({ link: LinkSchema }));
    set({ pairing: r.link.pairing_code });
    void linksStore.getState().refresh();
  },
  unlinkIM: async (id) => {
    await adminAPI.deleteVoid(`/notify/im/${id}`);
    void linksStore.getState().refresh();
  },
}));

// useLinkPolling —— while a chat waits for its pairing code, re-read the list so "linked" shows.
function useLinkPolling(waiting: boolean): void {
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => {
      linksStore.getState().refresh().catch((e: unknown) => {
        logger.warn('notify: linked-chat poll failed; retrying next tick', e);
      });
    }, LINK_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting]);
}

export interface NotifyHook {
  rules: { status: ResourceStatus; data: Rule[] };
  links: IMLink[];
  types: NotifyType[];
  codes: CodeOption[];
  endpoints: EndpointOption[];
  pairing: string | null;
  error: string | null;
}

export function useNotify(): NotifyHook {
  const rules = useResource(rulesStore);
  const links = useResource(linksStore);
  const types = useResource(typesStore);
  const codes = useResource(codesStore);
  const endpoints = useResource(endpointsStore);
  const pairing = notifyStore((s) => s.pairing);
  useEffect(() => {
    notifyStore.setState({ pairing: null });
    for (const s of [rulesStore, linksStore, codesStore, endpointsStore]) void s.getState().refresh();
    void typesStore.getState().ensureLoaded();
  }, []);
  useLinkPolling((links.data ?? []).some((l) => !l.linked));
  return {
    rules: { status: rules.status, data: rules.data ?? [] },
    links: links.data ?? [], types: types.data ?? [], codes: codes.data ?? [],
    endpoints: endpoints.data ?? [], pairing,
    error: rules.error ?? links.error ?? types.error,
  };
}

// ── pure helpers (tested in use-notify.test.ts) ───────

// CODE_KEY —— the data key a code filter uses; a type that declares it gets the code picker.
export const CODE_KEY = 'code_id';

export function filtersByCode(types: readonly NotifyType[], eventType: string): boolean {
  return types.find((t) => t.type === eventType)?.filterable.includes(CODE_KEY) === true;
}

// ruleBody —— the draft as the backend reads it: the code filter only where the type allows it.
export function ruleBody(d: RuleDraft, types: readonly NotifyType[]): Record<string, unknown> {
  const byCode = filtersByCode(types, d.eventType) && d.filterValue !== '';
  const [channel = 'email', ref = ''] = d.channel.split(':');
  return {
    event_type: d.eventType,
    filter_key: byCode ? CODE_KEY : '',
    filter_value: byCode ? d.filterValue : '',
    first_only: d.firstOnly,
    channel, channel_ref: ref,
    template: d.template.trim(),
  };
}

export interface ChannelOption { value: string; label: string }

// channelOptions —— email, every linked chat (by platform), every webhook endpoint (by URL).
export function channelOptions(
  links: readonly IMLink[], endpoints: readonly EndpointOption[], emailLabel: string,
): ChannelOption[] {
  return [
    { value: 'email', label: emailLabel },
    ...links.filter((l) => l.linked).map((l) => ({ value: `im:${l.id}`, label: platformLabel(l.platform) })),
    ...endpoints.map((e) => ({ value: `webhook:${e.id}`, label: e.url })),
  ];
}

export function platformLabel(platform: string): string {
  return platform === '' ? '' : platform[0]?.toUpperCase() + platform.slice(1);
}

// ruleSummary —— one rule as a line: what it watches, what it keeps, where it goes.
export function ruleSummary(
  r: Rule, codes: readonly CodeOption[], links: readonly IMLink[], endpoints: readonly EndpointOption[],
): { watches: string; keeps: string; to: string } {
  const code = codes.find((c) => c.id === r.filter_value)?.code ?? r.filter_value;
  const keeps = r.filter_key === CODE_KEY ? code : r.filter_value;
  const to = r.channel === 'im'
    ? platformLabel(links.find((l) => l.id === r.channel_ref)?.platform ?? '')
    : r.channel === 'webhook' ? endpoints.find((e) => e.id === r.channel_ref)?.url ?? '' : r.channel;
  return { watches: r.event_type, keeps, to };
}
