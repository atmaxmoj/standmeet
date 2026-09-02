// use-session-doc —— when the public landing shows a lockscreen, uses the
// visitor's session to fetch the full cited document via corpus_read. No
// session / no access → null (lockscreen stays). Logic lives in lib (the
// components layer bans if).

'use client';

import { useEffect, useState } from 'react';

import { fetchVisitorDoc, type VisitorDoc } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';

export interface SessionDocState {
  loading: boolean;
  doc: VisitorDoc | null;
  // hasSession —— whether this visitor has a code in hand. When the doc
  // can't be read, this decides what the lockscreen should say.
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
      // hasSession must go out alongside doc: when the doc can't be read,
      // **which line to say** depends on whether the visitor has a code,
      // not on why this particular one couldn't be read (F-R-6). The
      // backend returns 404 uniformly for both "no access" and "doesn't
      // exist" (never admitting existence), and the client can't tell
      // those two apart; but it can tell whether there's a session, and
      // that's exactly what decides what to say next.
      if (alive) setState({ loading: false, doc, hasSession: true });
    });
    return () => { alive = false; };
  }, [path]);
  return state;
}
