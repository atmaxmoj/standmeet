// ports.ts —— 3 DI ports. agent-core 内部只对这些 interface 编程；
// H.10 后 agent loop 搬进 backend (eino ADK)，浏览器降为 event consumer：
// VisitorTurnAgent 只需 PromptSource + TurnStreamer + EventObserver，
// 换 host (prod browser HTTP adapter / 未来 IM bridge) 只写这 3 个 adapter。

import type { AgentEvent, AgentTurnEvent, Message } from './types.js';

// PromptSource —— 拿 system prompt fragment 文本。prod 走 HTTP GET
// /api/v1/prompts/{id}；eval 走 fs.readFile。
export interface PromptSource {
  load(id: string): Promise<string>;
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
  // docContext —— 访客发问时正看着哪篇 doc(reader/wiki/output 页或浮窗所在页),
  // backend 注进 instruction 让代词指代("this page"/"这篇")解析得到。
  readonly docContext?: DocContext;
}

// DocContext —— 访客当前所在 document 的最小标识(给 AI 解析指代用)。
export interface DocContext {
  readonly title: string;
  readonly path: string;
  readonly genre: string; // wiki | output | writing
}

// TurnStreamer —— H.10: agent-core 单一出口，浏览器调一次发一整轮事件
// 流回来；backend (eino ADK) 全权处理 LLM ↔ tool 闭环 + summarization。
export interface TurnStreamer {
  stream(req: TurnRequest): AsyncIterable<AgentTurnEvent>;
}
