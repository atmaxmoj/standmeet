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
  if (res.body === null) {
    // 把 HTTP status 挂在 error 上,让上层(agent-core send)区分 401/403
    // (session 失效 → 提示重进)和真正的连接掉线。
    throw statusError(res.status);
  }
  // **非 2xx 也要把 body 读完。**
  //
  // 后端每一条 pre-stream 错误都写成 `text/event-stream` + 非 2xx +
  // `event: error / data: {code, message}`(`llm_chat_stream.go` 的 `writeLLMPreStreamErr`),
  // 而 message 是它**专门为读者写好的那句话** —— 八条,各说各的原因:
  // owner_unconfigured / overloaded / network / timeout / rate_limited /
  // unsupported_provider / invalid_api_key / endpoint_blocked。
  //
  // 这里原来是 `if (!res.ok) throw`:body 一个字节都没读就扔了,于是那八句话一句都到不了
  // 屏幕上,全塌成 agent-core 按 status 猜的兜底话术(F-A-24 的访客那一半)。
  // 现场是 prod 刚认领完那台:后端回 503 + "This page doesn't have an AI provider set up
  // yet.",访客读到的却是"连接断了,再问一次" —— 连接好好的,而再问一万次也是这一句。
  // 401 那格更糟:owner 的 key 坏了,产品对访客说"你的会话失效了,重开访问链接"。
  //
  // **服务端自己写的原因,永远比按状态码猜的强。**信封空着才退回状态码那条路
  // ([[collapsed-error-class-kills-its-own-branch]])。
  let sawEvent = false;
  for await (const ev of parseAgentTurnSSE(res.body)) {
    sawEvent = true;
    yield ev;
  }
  // body 里什么都没有(非 SSE 的 502 页 / 空响应) → 401/403 那条分支还得留着:
  // 它是「重进」和「重试」的分界,而那时确实没有别的凭据。
  if (!res.ok && !sawEvent) throw statusError(res.status);
}

function statusError(status: number): Error {
  return Object.assign(new Error(`agent.turn: ${status}`), { status });
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
