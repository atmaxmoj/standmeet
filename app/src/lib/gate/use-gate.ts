// use-gate —— /gate 的状态机。
//
// 三条 submit 路径：
//   - code: POST /api/v1/sessions {tier:'code', code} → 拿 session_token →
//     redirect / (chat 实例 mount 时复用 cookie/session)
//   - byoai: POST /api/v1/sessions {tier:'byoai', byoai_provider}（server 端
//     只要 provider，endpoint+model 在 chat header 里走）→ session 拿到后
//     把 BYOAI {provider,endpoint,model,key} 一坨进 browser vault
//     (lib/gate/byoai-vault.ts) → redirect /
//   - request: POST /api/v1/access-requests (无 handle field —— v1 单 owner)
//
// 都是 client-side hook；业务逻辑都在这里。Components 只渲染。

import { useCallback, useState } from 'react';

import {
  issueBYOAISession,
  issueCodeSession,
  type PublicSessionResponse,
} from '@/lib/api/public';
import { storeBYOAI } from '@/lib/gate/byoai-vault';
import { useVisitorSessionStore } from '@/lib/visitor/session-store';

const BYOAI_STORAGE_KEY = 'standmeet:visitor-session';

import { z } from 'zod';

import { safeJsonString } from '@/lib/api/typed-json';

const StoredVisitorSessionSchema = z.object({
  session_token: z.string(), conversation_id: z.string(), byoai: z.boolean(),
});
type StoredVisitorSession = z.infer<typeof StoredVisitorSessionSchema>;

export function persistSession(sess: PublicSessionResponse, byoai: boolean): void {
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
  return raw ? safeJsonString(raw, StoredVisitorSessionSchema) : null;
}

// Provider —— BYOAI 提交时的 provider 名。string 不收窄，因为新 backend
// 支持 anthropic / openai / deepseek / kimi / groq / siliconflow / openrouter
// / together / custom 一长串，全枚举不划算；非法值 server 端会 reject。
export type Provider = string;

// BYOAISubmitInput —— /gate BYOAI panel submit 时一起提交的 4 个字段。
// endpoint + model 必填（custom 必须 owner 自填；preset 选了之后由 UI 预填
// 默认值再走这里，所以走到这一步永远非空）。key 由 vault 加密落 localStorage，
// session 仍只发 provider 给 server。
export interface BYOAISubmitInput {
  provider: Provider;
  endpoint: string;
  model: string;
  key: string;
}

type SubmitState = { busy: boolean; error: string | null };

export interface GateHook {
  state: SubmitState;
  submitCode: (code: string, visitorName: string) => Promise<boolean>;
  submitBYOAI: (input: BYOAISubmitInput) => Promise<boolean>;
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
      const trimmedCode = code.trim();
      const trimmedName = visitorName.trim();
      const sess = await issueCodeSession({
        code: trimmedCode, visitor_name: trimmedName,
      });
      persistSession(sess, false);
      useVisitorSessionStore.getState().setSession({
        code: sess.code ?? trimmedCode,
        visitor: sess.visitor_name ?? trimmedName ?? null,
        byoai: false,
        byoaiProvider: '',
        label: null,
        used: sess.quota?.used_turns ?? 0,
        max: sess.quota?.max_turns ?? 0,
        startedAt: Date.now(),
      });
      return true;
    });
  }, []);

  const submitBYOAI = useCallback(
    async (input: BYOAISubmitInput): Promise<boolean> => {
      return await runSubmit(setState, async () => {
        const sess = await issueBYOAISession({ byoai_provider: input.provider });
        await storeBYOAI({
          provider: input.provider,
          endpoint: input.endpoint.trim(),
          model: input.model.trim(),
          key: input.key.trim(),
        });
        persistSession(sess, true);
        useVisitorSessionStore.getState().setSession({
          code: null,
          visitor: sess.visitor_name ?? null,
          byoai: true,
          byoaiProvider: input.provider,
          label: null,
          used: 0,
          max: 0,
          startedAt: Date.now(),
        });
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
