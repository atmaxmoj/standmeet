// use-members —— /admin/codes 卡里"members"展开块的状态机：
// 拉一个 code 的 member 列表（只读）。revoke 不在 member 级别——AccessCode
// 卡顶 revoke 一动整 code，跟产品语义对齐。

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
