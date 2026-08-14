// use-session-doc —— 公开 landing 锁屏时,凭访客 session 走 corpus_read 把被引
// 文档全文取回来。无 session / 无权 → null(留锁屏)。逻辑在 lib(组件层禁 if)。

'use client';

import { useEffect, useState } from 'react';

import { fetchVisitorDoc, type VisitorDoc } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';

export interface SessionDocState {
  loading: boolean;
  doc: VisitorDoc | null;
  // hasSession —— 这位访客手里有没有码。读不到这一条时，锁屏该说的话由它决定。
  hasSession: boolean;
}

export function useSessionScopedDoc(path: string): SessionDocState {
  const [state, setState] = useState<SessionDocState>({ loading: true, doc: null, hasSession: false });
  useEffect(() => {
    const sess = loadStoredSession();
    const token = sess?.session_token ?? '';
    const conv = sess?.conversation_id ?? '';
    if (token === '' || conv === '') {
      setState({ loading: false, doc: null, hasSession: false });
      return;
    }
    let alive = true;
    void fetchVisitorDoc(conv, token, path).then((doc) => {
      // hasSession 要跟着 doc 一起出去：读不到的时候，**该说哪句话**取决于访客手里有没有码，
      // 而不取决于这一条读不到（F-R-6）。后端对越权和不存在一律 404（不承认存在），
      // 客户端分不出那两种；但它分得出有没有会话，而那正是决定下一步该说什么的那一位。
      if (alive) setState({ loading: false, doc, hasSession: true });
    });
    return () => { alive = false; };
  }, [path]);
  return state;
}
