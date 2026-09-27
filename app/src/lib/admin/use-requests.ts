// use-requests —— /admin/requests state. GET list + PATCH status.
// Defaults to filtering by status=open; clicking a chip switches between
// "open / replied / closed / all".
//
// zustand refactor: fetch everything at once, filter runs client-side;
// switching a chip no longer hits the network.
//
// Approving issues a code at once and queues its mail; the row's `mail` says sending → sent /
// failed, and its status turns replied only after the mail went. The list re-reads while any mail
// is sending, so the owner watches it land without reloading.

'use client';

import { useCallback, useEffect, useState } from 'react';

import { z } from 'zod';
import {
  adminAPI, AccessRequestViewSchema, MailReceiptSchema, type AccessRequestView,
} from '@/lib/api/admin';
import {
  mailInFlight, sameIds, visibleRows, type RequestStatusFilter,
} from '@/lib/admin/request-rows';
import { createResourceStore, useResource } from '@/lib/state/create-resource-store';
import type { ResourceStatus } from '@/lib/state/status';

export type { RequestStatusFilter } from '@/lib/admin/request-rows';

export type RequestsBodyState = 'loading' | 'error' | 'empty' | 'list';

// MAIL_POLL_MS —— how often the list re-reads while a mail is sending.
const MAIL_POLL_MS = 2_000;

// pickBodyState —— used by RequestsSection, avoids an if-ladder in the .tsx that would trip cyclo.
export function pickBodyState(
  hook: { status: ResourceStatus; error: string | null; rows: readonly unknown[] },
): RequestsBodyState {
  if (hook.status === 'idle' || hook.status === 'loading') return 'loading';
  if (hook.status === 'error') return 'error';
  return hook.rows.length === 0 ? 'empty' : 'list';
}

export interface RequestsHook {
  status: ResourceStatus;
  rows: readonly AccessRequestView[];
  error: string | null;
  filter: RequestStatusFilter;
  setFilter: (f: RequestStatusFilter) => void;
  mark: (id: string, status: 'replied' | 'closed') => Promise<void>;
  approve: (id: string) => Promise<ApproveOutcome>;
}

export interface ApproveOutcome {
  ok: boolean;
  code?: string;
  error?: string;
}

const ApproveResultSchema = z.object({ code: z.string(), link: z.string(), mail: MailReceiptSchema });

export const requestsStore = createResourceStore<AccessRequestView[]>({
  name: 'access-requests',
  fetcher: () => adminAPI.get('/access-requests', z.array(AccessRequestViewSchema)),
});

// useMailPolling —— while any mail is sending, re-read the list so its state lands on screen.
function useMailPolling(sending: boolean): void {
  useEffect(() => {
    if (!sending) return undefined;
    const timer = setInterval(() => { void requestsStore.getState().refreshSilent(); }, MAIL_POLL_MS);
    return () => clearInterval(timer);
  }, [sending]);
}

// useHeldRows —— the filtered rows, keeping the ones already on screen (see request-rows.ts).
// The held ids are adjusted during render when they change (React's derived-state pattern), not in
// an effect, so a row never flickers out for one frame.
function useHeldRows(
  all: readonly AccessRequestView[], filter: RequestStatusFilter,
): readonly AccessRequestView[] {
  const [held, setHeld] = useState<{ filter: RequestStatusFilter; ids: readonly string[] }>(
    { filter, ids: [] },
  );
  const rows = visibleRows(all, filter, held.filter === filter ? held.ids : []);
  const ids = rows.map((r) => r.id);
  if (held.filter !== filter || !sameIds(ids, held.ids)) setHeld({ filter, ids });
  return rows;
}

export function useRequests(): RequestsHook {
  const r = useResource(requestsStore);
  const ensureLoaded = r.ensureLoaded;
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);
  const [filter, setFilter] = useState<RequestStatusFilter>('open');
  const all = r.data ?? [];
  useMailPolling(mailInFlight(all));
  const rows = useHeldRows(all, filter);

  // mark throws (no longer swallowed): the caller finishes up with useAction (success toast / failure report).
  const mark = useCallback(async (id: string, status: 'replied' | 'closed'): Promise<void> => {
    const updated = await adminAPI.patch(
      `/access-requests/${id}`, { status }, AccessRequestViewSchema,
    );
    requestsStore.getState().mutate((prev) =>
      (prev ?? []).map((row) => row.id === id ? updated : row));
  }, []);

  // approve —— the code is issued now; the row is re-read, not assumed replied: it turns replied
  // only once its mail went out.
  const approve = useCallback(async (id: string): Promise<ApproveOutcome> => {
    try {
      const res = await adminAPI.post(`/access-requests/${id}/approve`, {}, ApproveResultSchema);
      await requestsStore.getState().refreshSilent();
      return { ok: true, code: res.code };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Approve failed' };
    }
  }, []);

  return {
    status: r.status,
    rows,
    error: r.error,
    filter,
    setFilter,
    mark,
    approve,
  };
}
