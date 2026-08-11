// use-gate —— /gate 的状态机。
//
// 三条 submit 路径：
//   - code: POST /api/v1/sessions {mode:'code', code} → 拿 session_token →
//     redirect / (chat 实例 mount 时复用 cookie/session)
//   - byoai: POST /api/v1/sessions {mode:'byoai', byoai_provider}（server 端
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
import { rememberVisitorName } from '@/lib/visitor/visitor-name';

const BYOAI_STORAGE_KEY = 'standmeet:visitor-session';

import { z } from 'zod';

import { safeJsonString } from '@/lib/api/typed-json';

// Cap state + tool spec also persisted (was missing before — D-5 pivot
// regression where reuseStored returned partial state without capabilities,
// pi-agent saw current()=[] and sent tools:[] to /inference/stream,
// breaking all visitor tool calls in prod).
const ToolSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  // G-8: throbber 文案随 spec 一起持久化；缺失 → fallback "running <name>"
  progress_label: z.string().optional(),
  input_schema: z.unknown(),
  // #134: 这个 tool 自带的 ui:// 卡 HTML（MCP Apps，per-tool）。随 spec 持久化，
  // 否则 code-mode 进站(gate issue → localStorage → chat reuse)那一跳被 zod 剥掉。
  ui_html: z.string().optional(),
});
const CapStateSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  quota_remaining: z.number().optional(),
  policy_summary: z.string().optional(),
  // extra —— 能力的附加状态（#134: 外置 MCP app 的 ui:// 卡 html / resource_uri
  // 挂在 ui 下）。必须保留 —— Zod 默认 strip 未知键，漏了它 reuseStored 会把
  // 沙盒卡的 html 丢掉，前端渲不出卡。
  extra: z.unknown().optional(),
});
// DockButtonSchema —— #109/#110 dock 按钮持久化：reuse session 第二次进站仍看到按钮。
const DockButtonSchema = z.object({
  capability_id: z.string(),
  title: z.string(),
  trigger: z.string(),
});
const StoredVisitorSessionSchema = z.object({
  session_token: z.string(),
  conversation_id: z.string(),
  byoai: z.boolean(),
  capabilities: z.array(CapStateSchema).optional(),
  tool_specs: z.array(ToolSpecSchema).optional(),
  system_prompt_part_ids: z.array(z.string()).optional(),
  system_prompt_persona: z.string().optional(),
  // H.13.d: code-mode 初始 ghost 队列也持久化；reused session 第二
  // 次进站仍能看到 owner 设的 suggested ghost。
  ghosts: z.array(z.string()).nullish().transform((v) => v ?? undefined), // F-D-1 class: ghosts can be null
  dock_buttons: z.array(DockButtonSchema).optional(),
});
type StoredVisitorSession = z.infer<typeof StoredVisitorSessionSchema>;

export function persistSession(sess: PublicSessionResponse, byoai: boolean): void {
  if (typeof window === 'undefined') return;
  // PublicSessionResponse uses readonly arrays; zod-inferred Stored shape
  // uses mutable. Spread into fresh mutable arrays so the type-check passes
  // without unsafe casts; JSON.stringify treats both the same anyway.
  const data: StoredVisitorSession = {
    session_token: sess.session_token,
    conversation_id: sess.conversation_id,
    byoai,
    capabilities: sess.capabilities ? [...sess.capabilities] : undefined,
    tool_specs: sess.tool_specs ? [...sess.tool_specs] : undefined,
    system_prompt_part_ids: sess.system_prompt_part_ids
      ? [...sess.system_prompt_part_ids] : undefined,
    system_prompt_persona: sess.system_prompt_persona,
    ghosts: sess.ghosts
      ? [...sess.ghosts] : undefined,
    dock_buttons: sess.dock_buttons ? [...sess.dock_buttons] : undefined,
  };
  window.localStorage.setItem(BYOAI_STORAGE_KEY, JSON.stringify(data));
}

// storeDisplaySession —— 把 issue 响应折进 SessionStrip 展示 store。code/byoai
// 两条路径共用:role-specific 字段(code/visitor/byoai/provider)由 caller 传,其余
// quota/members/startedAt + #122 的 email/ownerCanDeliver 在这里统一映射。
function storeDisplaySession(
  sess: PublicSessionResponse,
  fields: { code: string | null; visitor: string | null; byoai: boolean; byoaiProvider: string },
): void {
  useVisitorSessionStore.getState().setSession({
    ...fields,
    // label —— 这张码的名字，strip 和欢迎语拿它说「你进的是哪一片」。以前这里写死
    // null，于是两处的 `?? 'invited'` 兜底恒定生效，每张码都被说成 invited（UX-68）。
    // 兜底本身是对的（设计源：没标签才退回），错的是把真值扔在这一行。
    label: sess.code_label ?? null,
    used: sess.quota.used_turns,
    max: sess.quota.max_turns,
    maxMembers: sess.quota.max_members,
    memberCount: sess.members.length,
    startedAt: Date.now(),
    email: '',
    ownerCanDeliver: sess.owner_can_deliver ?? false,
  });
}

export function loadStoredSession(): StoredVisitorSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BYOAI_STORAGE_KEY);
  return raw ? safeJsonString(raw, StoredVisitorSessionSchema) : null;
}

// clearStoredSession —— 删掉 chat 鉴权凭据(session_token + conversation_id)。
// session 失效(401)时跟 useVisitorSessionStore.clear() 一起调,免得拿着死
// token 反复打后端。
export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(BYOAI_STORAGE_KEY);
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
      // F-A-5: keep the remembered name in sync with the /gate entry so a later
      // VisitorNamePicker (a genuinely new code) prefills THIS identity, not a
      // stale name from an earlier picker use.
      (trimmedName !== '') && rememberVisitorName(trimmedName);
      persistSession(sess, false);
      storeDisplaySession(sess, {
        code: sess.code ?? trimmedCode,
        visitor: sess.visitor_name ?? trimmedName ?? null,
        byoai: false, byoaiProvider: '',
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
        storeDisplaySession(sess, {
          code: null, visitor: sess.visitor_name ?? null,
          byoai: true, byoaiProvider: input.provider,
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
    setState({ busy: false, error: submitErrorText(e) });
    return false;
  }
}

// submitErrorText —— 后端为每一种拒绝都写了一句给访客看的话("no such access code…"、
// "this access code was revoked…"、"this code is full…"),那就把那句话说出来。
// 每一句都指向不同的下一步,所以这一层不许把它们归并(F-D-6)。拿不到才退到一句通用的:
// `issue session: 403` 这种给不了访客任何东西(F-A-23)。
function submitErrorText(e: unknown): string {
  const fromServer = serverMessageOf(e);
  return fromServer !== '' ? fromServer : 'Couldn’t check that just now. Try again.';
}

// serverMessageOf —— SDK 把信封里的 message 挂在抛出的 Error 上。类型断言在这个 repo 里
// 是禁的,所以走 in + typeof 逐步收窄。
function serverMessageOf(e: unknown): string {
  if (typeof e !== 'object' || e === null || !('serverMessage' in e)) return '';
  const msg: unknown = e.serverMessage;
  return typeof msg === 'string' ? msg : '';
}
