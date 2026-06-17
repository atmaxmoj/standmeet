// agent-adapters.ts —— browser host adapters for @standmeet/agent-core.
// H.10 后 agent loop 搬进 backend (eino ADK)，浏览器只需 2 个 adapter：
//   - httpPromptSource     —— HTTP GET /api/v1/prompts/{id}
//   - httpAgentTurnStreamer —— POST /api/v1/agent/turn SSE，一次拿整轮事件
// (老的 LLMStreamer / ToolDispatcher / scripted mock 路径已随 VisitorAgent 删除)

import type {
  AgentTurnEvent,
  PromptSource,
  TurnRequest,
  TurnStreamer,
} from '@standmeet/agent-core';

import { parseAgentTurnSSE } from './agent-turn-sse';

// ───── PromptSource: HTTP GET /api/v1/prompts/{id} ────────────────

export interface HttpPromptSourceOptions {
  readonly baseURL: string;
}

export function httpPromptSource(opts: HttpPromptSourceOptions): PromptSource {
  return {
    async load(id: string): Promise<string> {
      const res = await fetch(`${opts.baseURL}/api/v1/prompts/${id}`);
      if (!res.ok) {
        throw new Error(`prompts.load(${id}): ${res.status}`);
      }
      return await res.text();
    },
  };
}

// ───── BYOAI 信封 headers ─────────────────────────────────────────
//
// byoai mode 下 visitor browser 持 plaintext key + HKDF(session_token)
// 派 AES key 信封，X-BYOAI-* headers 带过来；server 解封即用即丢。

export interface HttpBYOAIHeaders {
  readonly provider: string;
  readonly wrappedKey: string; // base64 url-safe no-pad envelope
  readonly endpoint: string;
  readonly model: string;
}

// ───── TurnStreamer (HTTP, prod): POST /api/v1/agent/turn ─────────
//
// H.10: backend (eino ADK) 接管 agent loop；浏览器只调一次 /agent/turn，
// SSE 收整套事件 (text / tool_started / tool_completed / done / error)。

export interface HttpAgentTurnStreamerOptions {
  readonly baseURL: string;
  readonly sessionToken: string;
  readonly byoai?: HttpBYOAIHeaders;
}

export function httpAgentTurnStreamer(
  opts: HttpAgentTurnStreamerOptions,
): TurnStreamer {
  return {
    stream(req: TurnRequest): AsyncIterable<AgentTurnEvent> {
      return streamAgentTurnHTTP(opts, req);
    },
  };
}

async function* streamAgentTurnHTTP(
  opts: HttpAgentTurnStreamerOptions, req: TurnRequest,
): AsyncIterable<AgentTurnEvent> {
  const res = await fetch(`${opts.baseURL}/api/v1/agent/turn`, {
    method: 'POST',
    headers: turnHeaders(opts),
    body: JSON.stringify({
      system: req.system,
      user_message: req.userMessage,
      conversation_id: req.conversationID,
      history: req.history,
      // doc_context —— 当前所在 doc(title/path/genre);backend 注进 instruction
      // 让指代解析。undefined 时 JSON.stringify 直接省掉(主 chat 全屏不带)。
      doc_context: req.docContext,
      // #120: 访客浏览器时区,每轮上送。backend 锚进通用 instruction,让 agent 按
      // 访客时区解释其给出的时间(尤其 booking),不再含糊/反问。
      visitor_timezone: browserTimezone(),
    }),
  });
  if (!res.ok || res.body === null) {
    // 把 HTTP status 挂在 error 上,让上层(agent-core send)区分 401/403
    // (session 失效 → 提示重进)和真正的连接掉线。
    throw Object.assign(new Error(`agent.turn: ${res.status}`), { status: res.status });
  }
  yield* parseAgentTurnSSE(res.body);
}

// browserTimezone —— 访客 IANA tz(Intl…timeZone)。环境拿不到 → 空字符串
// (backend 退回"先问访客时区"的措辞)。
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

function turnHeaders(opts: HttpAgentTurnStreamerOptions): HeadersInit {
  const base: Record<string, string> = {
    Authorization: `Bearer ${opts.sessionToken}`,
    'Content-Type': 'application/json',
  };
  return opts.byoai ? { ...base, ...byoaiToHeaders(opts.byoai) } : base;
}

function byoaiToHeaders(b: HttpBYOAIHeaders): Record<string, string> {
  return {
    'X-BYOAI-Provider': b.provider,
    'X-BYOAI-Key': b.wrappedKey,
    'X-BYOAI-Endpoint': b.endpoint,
    'X-BYOAI-Model': b.model,
  };
}
