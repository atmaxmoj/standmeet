// use-requests —— /admin/requests state. One page at a time + PATCH status.
// Defaults to status=open; clicking a chip switches between "open / replied / closed / all",
// which re-queries the server (docs/design/paging.md).
//
// Approving issues a code at once and queues its mail; the row's `mail` says sending → sent /
// failed, and its status turns replied only after the mail went. The rows whose mail is sending
// are re-read by id until none is, so the owner watches it land without reloading.

'use client';

import { useCallback, useEffect } from 'react';

import { z } from 'zod';
import {
  adminAPI, AccessRequestViewSchema, MailReceiptSchema, type AccessRequestView,
} from '@/lib/api/admin';
import {
  filterOf, mailInFlight, statusParam, type RequestStatusFilter,
} from '@/lib/admin/request-rows';
import { createPagedStore, usePaged, type PagedState } from '@/lib/state/create-paged-store';
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
  page: PagedState<AccessRequestView>;
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

// requestsPage —— one page at a time, newest first, opening on the open requests.
export const requestsPage = createPagedStore({
  name: 'access-requests', path: '/access-requests', item: AccessRequestViewSchema,
  params: { status: 'open' },
});

const OnePageSchema = z.object({ items: z.array(AccessRequestViewSchema) });

// rereadRow —— one request as the server has it now, put in place (it stays on screen even if
// its status has left the current filter).
async function rereadRow(id: string): Promise<void> {
  const { items } = await adminAPI.get(`/access-requests?id=${encodeURIComponent(id)}`, OnePageSchema);
  const fresh = items[0];
  if (fresh) requestsPage.getState().patch(id, () => fresh);
}

// useMailPolling —— while any mail is sending, re-read those rows so their state lands on screen.
function useMailPolling(sendingIDs: string): void {
  useEffect(() => {
    if (sendingIDs === '') return undefined;
    const reread = () => { for (const id of sendingIDs.split(',')) void rereadRow(id).catch(() => undefined); };
    const timer = setInterval(reread, MAIL_POLL_MS);
    return () => clearInterval(timer);
  }, [sendingIDs]);
}

export function useRequests(): RequestsHook {
  const page = usePaged(requestsPage);
  useMailPolling(mailInFlight(page.items).map((r) => r.id).join(','));
  const { setParams } = page;
  const setFilter = useCallback(
    (f: RequestStatusFilter) => setParams({ status: statusParam(f) }), [setParams],
  );

  // mark throws (no longer swallowed): the caller finishes up with useAction (success toast / failure report).
  const mark = useCallback(async (id: string, status: 'replied' | 'closed'): Promise<void> => {
    const updated = await adminAPI.patch(
      `/access-requests/${id}`, { status }, AccessRequestViewSchema,
    );
    requestsPage.getState().patch(id, () => updated);
  }, []);

  // approve —— the code is issued now; the row is re-read, not assumed replied: it turns replied
  // only once its mail went out.
  const approve = useCallback(async (id: string): Promise<ApproveOutcome> => {
    try {
      const res = await adminAPI.post(`/access-requests/${id}/approve`, {}, ApproveResultSchema);
      await rereadRow(id);
      return { ok: true, code: res.code };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Approve failed' };
    }
  }, []);

  return {
    status: page.status,
    rows: page.items,
    error: page.error,
    page,
    filter: filterOf(page.params.status),
    setFilter,
    mark,
    approve,
  };
}
