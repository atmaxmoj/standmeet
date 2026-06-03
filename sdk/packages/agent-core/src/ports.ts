// ports.ts —— 5 DI ports. agent-core 内部只对这些 interface 编程；
// 同 agent loop 在 prod browser (HTTP adapters) / Node eval harness
// (fs + canned + pi-ai DeepSeek adapters) / 未来 IM bridge (Slack
// adapters) 全靠不同 adapter 注入跑起来。
//
// 命名跟 [[visitor-chat-frontend-pi-pivot]] memory 锁的一致：换 host
// 只写这 5 个 adapter。

import type { AgentEvent, AgentTurnEvent, CapabilityState, Message, ToolCall, ToolResult } from './types.js';

// PromptSource —— 拿 system prompt fragment 文本。prod 走 HTTP GET
// /api/v1/prompts/{id}；eval 走 fs.readFile。
export interface PromptSource {
  load(id: string): Promise<string>;
}

// CapabilityStateSource —— 读当前 session 可用 capability + quota /
// policy。prod 是 zustand store (POST /sessions 时初始化，tool
// dispatcher response 自动同步)；eval 是 scenario 里写死的常量 +
// 测试 mutator。
export interface CapabilityStateSource {
  current(): readonly CapabilityState[];
  // 可选订阅：state 变化时主动推送给 caller，例如 pi 重装配 tool list。
  // 返回 unsubscribe。
  onChange?(cb: (states: readonly CapabilityState[]) => void): () => void;
}

// LLMStreamRequest —— 给 LLMStreamer.stream 的输入。pi-ai compatible。
export interface LLMStreamRequest {
  readonly system: string;
  readonly messages: readonly Message[];
  readonly toolSpecs: readonly LLMToolSpec[];
}

export interface LLMToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
}

// LLMStreamEvent —— streamer 一次 stream 的事件序列。
export type LLMStreamEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool_call'; readonly call: ToolCall }
  | { readonly type: 'done'; readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' };

// LLMStreamer —— LLM 出口。prod 走 POST /inference/stream raw forwarder；
// eval 直接调 pi-ai 配 DeepSeek key。两边都 yield 同一 LLMStreamEvent。
export interface LLMStreamer {
  stream(req: LLMStreamRequest): AsyncIterable<LLMStreamEvent>;
}

// ToolDispatcher —— 派发 tool call。prod 走 POST /sessions/{id}/tools/{name}；
// eval 用 canned 表查。返 ToolResult 让 agent loop 决定下一步。
// 失败语义统一走 envelope (ok=false + reason)；caller 不 throw，让
// observer 看到失败的细节。
export interface ToolDispatcher {
  call(call: ToolCall): Promise<ToolResult>;
}

// EventObserver —— 接 agent loop 所有 transition。prod 是 React
// useReducer/store；eval 是 transcript printer (彩色 stdout / JSONL)。
// 单一方法保持简单；caller 自己分流。
export interface EventObserver {
  onEvent(event: AgentEvent): void;
}

// TurnRequest —— H.10: 浏览器跑一整轮 visitor chat 的 wire payload。
// 直接对应 backend POST /api/v1/agent/turn 的 body shape。
// conversationID 让 backend tool (calendar_book / persist) 找得到对应
// chat 行；空字符串会让 BookMeeting 等下游 UUID parse 失败。
export interface TurnRequest {
  readonly system: string;
  readonly userMessage: string;
  readonly conversationID: string;
  readonly history: readonly Message[];
}

// TurnStreamer —— H.10: agent-core 单一出口，浏览器调一次发一整轮事件
// 流回来；backend (eino ADK) 全权处理 LLM ↔ tool 闭环 + summarization。
// 老 LLMStreamer / ToolDispatcher 路径仍存在 (H.12 sweep 时再删)。
export interface TurnStreamer {
  stream(req: TurnRequest): AsyncIterable<AgentTurnEvent>;
}
