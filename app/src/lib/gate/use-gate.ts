// use-gate —— /gate 的状态机。
//
// 三条 submit 路径：
//   - code: POST /api/v1/sessions {tier:'code', code} → 拿 session_token →
//     redirect / (chat 实例 mount 时复用 cookie/session)
//   - byoai: POST /api/v1/sessions {tier:'byoai', byoai_provider, byoai_key}
//     → localStorage 存 token + key → redirect /?byoai=1
//   - request: POST /api/v1/access-requests (无 handle field —— v1 单 owner)
//
// 都是 client-side hook；业务逻辑都在这里。Components 只渲染。

import { useCallback, useState } from 'react';

import {
  issueBYOAISession,
  issueCodeSession,
  type PublicSessionResponse,
} from '@/lib/api/public';

const BYOAI_STORAGE_KEY = 'standmeet:visitor-session';

interface StoredVisitorSession {
  session_token: string;
  conversation_id: string;
  byoai: boolean;
}

function persistSession(sess: PublicSessionResponse, byoai: boolean): void {
  if (typeof window === 'undefined') return;
  const data: StoredVisitorSession = {
    session_token: sess.session_token,
    conversation_id: sess.conversation_id,
    byoai,
  };
  window.localStorage.setItem(BYOAI_STORAGE_KEY, JSON.stringify(data));
}

export function loadStoredSession(): StoredVisitorSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BYOAI_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredVisitorSession) : null;
}

export type Provider = 'anthropic' | 'openai';

type SubmitState = { busy: boolean; error: string | null };

export interface GateHook {
  state: SubmitState;
  submitCode: (code: string, visitorName: string) => Promise<boolean>;
  submitBYOAI: (provider: Provider, key: string) => Promise<boolean>;
  submitRequest: (input: AccessRequestInput) => Promise<boolean>;
}

export interface AccessRequestInput {
  email: string;
  name: string;
  org: string;
  message: string;
}

export function useGate(): GateHook {
  const [state, setState] = useState<SubmitState>({ busy: false, error: null });

  const submitCode = useCallback(async (
    code: string, visitorName: string,
  ): Promise<boolean> => {
    return await runSubmit(setState, async () => {
      const sess = await issueCodeSession({
        code: code.trim(), visitor_name: visitorName.trim(),
      });
      persistSession(sess, false);
      return true;
    });
  }, []);

  const submitBYOAI = useCallback(
    async (provider: Provider, key: string): Promise<boolean> => {
      return await runSubmit(setState, async () => {
        const sess = await issueBYOAISession({
          byoai_provider: provider, byoai_key: key.trim(),
        });
        persistSession(sess, true);
        return true;
      });
    },
    [],
  );

  const submitRequest = useCallback(async (input: AccessRequestInput): Promise<boolean> => {
    return await runSubmit(setState, async () => {
      const res = await fetch('/api/v1/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`submit access request: ${res.status}`);
      return true;
    });
  }, []);

  return { state, submitCode, submitBYOAI, submitRequest };
}

async function runSubmit(
  setState: (s: SubmitState) => void,
  fn: () => Promise<boolean>,
): Promise<boolean> {
  setState({ busy: true, error: null });
  try {
    const ok = await fn();
    setState({ busy: false, error: null });
    return ok;
  } catch (e) {
    setState({ busy: false, error: e instanceof Error ? e.message : 'submit failed' });
    return false;
  }
}
