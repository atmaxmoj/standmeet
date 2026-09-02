// use-members —— state machine for the "members" expand block on an
// /admin/codes card: fetches a code's member list (read-only). Revoke is not
// a member-level operation — the AccessCode card's top-level revoke acts on
// the whole code, matching the product's semantics.

import { useEffect, useState } from 'react';

import { listCodeMembers, type MemberView } from '@/lib/admin/use-codes';

export type MembersState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; members: MemberView[]; error: string | null }
  | { kind: 'error'; message: string };

export interface MembersHook {
  state: MembersState;
}

export function useMembers(codeID: string, open: boolean): MembersHook {
  const [state, setState] = useState<MembersState>({ kind: 'idle' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void runLoad(codeID, cancelled, setState);
    return () => { cancelled = true; };
  }, [codeID, open]);

  return { state };
}

async function runLoad(
  codeID: string,
  cancelled: boolean,
  setState: (s: MembersState) => void,
): Promise<void> {
  setState({ kind: 'loading' });
  try {
    const members = await listCodeMembers(codeID);
    cancelled || setState({ kind: 'ready', members, error: null });
  } catch (e) {
    cancelled || setState({
      kind: 'error', message: e instanceof Error ? e.message : 'load failed',
    });
  }
}
