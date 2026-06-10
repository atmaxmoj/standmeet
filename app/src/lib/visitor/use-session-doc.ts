// use-session-doc —— 公开 landing 锁屏时,凭访客 session 走 corpus_read 把被引
// 文档全文取回来。无 session / 无权 → null(留锁屏)。逻辑在 lib(组件层禁 if)。

'use client';

import { useEffect, useState } from 'react';

import { fetchVisitorDoc, type VisitorDoc } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';

export interface SessionDocState {
  loading: boolean;
  doc: VisitorDoc | null;
}

export function useSessionScopedDoc(path: string): SessionDocState {
  const [state, setState] = useState<SessionDocState>({ loading: true, doc: null });
  useEffect(() => {
    const sess = loadStoredSession();
    const token = sess?.session_token ?? '';
    const conv = sess?.conversation_id ?? '';
    if (token === '' || conv === '') {
      setState({ loading: false, doc: null });
      return;
    }
    let alive = true;
    void fetchVisitorDoc(conv, token, path).then((doc) => {
      if (alive) setState({ loading: false, doc });
    });
    return () => { alive = false; };
  }, [path]);
  return state;
}
