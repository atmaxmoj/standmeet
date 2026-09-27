// use-members —— state machine for the "members" expand block on an
// /admin/codes card: a code's member list (read-only), one page at a time from the server
// (docs/design/paging.md). Revoke is not a member-level operation — the AccessCode card's
// top-level revoke acts on the whole code, matching the product's semantics.

import { useEffect, useState } from 'react';

import { MemberViewSchema, type MemberView } from '@/lib/admin/use-codes';
import { createPagedStore, type PagedState, type PagedStore } from '@/lib/state/create-paged-store';

export type MembersState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; members: readonly MemberView[]; error: string | null }
  | { kind: 'error'; message: string };

export interface MembersHook {
  state: MembersState;
  page: PagedState<MemberView>;
}

// useMembers —— the card's own store (each card lists its own code). Loads on every open, so a
// visitor who joined while the block was closed is there the next time it opens.
export function useMembers(codeID: string, open: boolean): MembersHook {
  const [store] = useState<PagedStore<MemberView>>(() => createPagedStore({
    name: 'code-members', path: `/codes/${codeID}/members`, item: MemberViewSchema,
  }));
  const page = store();
  const { reload } = page;
  useEffect(() => { if (open) void reload(); }, [open, reload]);
  return { state: toState(page), page };
}

function toState(page: PagedState<MemberView>): MembersState {
  if (page.status === 'idle') return { kind: 'idle' };
  if (page.status === 'loading') return { kind: 'loading' };
  if (page.status === 'error') return { kind: 'error', message: page.error ?? 'load failed' };
  return { kind: 'ready', members: page.items, error: page.error };
}
