// use-members —— /admin/codes 卡里"members"展开块的状态机：
// 拉一个 code 的 member 列表，可单独 revoke。

import { useCallback, useEffect, useState } from 'react';

import { listCodeMembers, revokeMember, type MemberView } from '@/lib/admin/use-codes';

export type MembersState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; members: MemberView[]; error: string | null }
  | { kind: 'error'; message: string };

export interface MembersHook {
  state: MembersState;
  reload: () => void;
  revoke: (memberID: string) => Promise<void>;
}

export function useMembers(codeID: string, open: boolean): MembersHook {
  const [state, setState] = useState<MembersState>({ kind: 'idle' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void runLoad(codeID, cancelled, setState);
    return () => { cancelled = true; };
  }, [codeID, open]);

  const reload = useCallback(() => {
    void runLoad(codeID, false, setState);
  }, [codeID]);

  const revoke = useCallback(async (memberID: string) => {
    await revokeMember(memberID);
    setState((s) => markMemberRevoked(s, memberID));
  }, []);

  return { state, reload, revoke };
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

function markMemberRevoked(s: MembersState, memberID: string): MembersState {
  if (s.kind !== 'ready') return s;
  return {
    kind: 'ready',
    error: null,
    members: s.members.map((m) => m.id === memberID ? { ...m, revoked: true } : m),
  };
}
