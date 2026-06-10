// types.ts —— shared agent core types, kept stable across hosts so any
// TurnStreamer / EventObserver impl knows the contract.

export interface CapabilityState {
  readonly id: string;
  readonly enabled: boolean;
  readonly quota_remaining?: number;
  readonly policy_summary?: string;
  readonly extra?: unknown;
}

// ToolResult —— tool 调用结果信封。matches pi-ai shape loosely so
// adapters can interop without translation layer.
export interface ToolResult {
  readonly id: string;
  readonly name: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly reason?: string;
  readonly detail?: string;
  readonly capability_state?: readonly CapabilityState[];
}

// Conversation message —— pi unified shape, mirrors eino schema.Message
// + OpenAI chat completions. assistant role MAY carry tool_calls (this
// turn's tool_use list); tool role carries tool_call_id (which tool_use
// id the result is for). 不走 marker string —— 字段类型化，跨 wire 1:1
// 翻给 backend eino。
export interface Message {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly tool_calls?: readonly ToolCallRef[];
  readonly tool_call_id?: string;
}

// ToolCallRef —— assistant turn 内调出的一条 tool_use 的小记录，挂在
// Message.tool_calls 上随 history 来回 (上轮调过的，喂回 backend 当上下文)。
export interface ToolCallRef {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

// AgentTurnEvent —— H.10: 新 wire 一条 SSE event。pi 端从 /api/v1/agent/turn
// 接到的形态；TurnStreamer 一个 turn 把整套事件 yield 完。
// H.13.c 加 `ghosts` 变体：code-accessor turn 收尾前 backend 出
// 3 条 follow-up question；浏览器把 items 队列追到 ghost text 后面。
export type AgentTurnEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool_started'; readonly id: string; readonly name: string; readonly args: unknown; readonly progressLabel?: string }
  | { readonly type: 'tool_completed'; readonly name: string; readonly result: string }
  | { readonly type: 'ghosts'; readonly items: readonly string[] }
  | { readonly type: 'retrying'; readonly attempt: number }
  | { readonly type: 'done'; readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

// AgentEvent —— observer receives one per state transition. Names align
// with eval harness scenarios. H.13.c 加 `ghosts_received`：
// VisitorTurnAgent 收到 SSE `ghosts` 事件时往 observer 发；UI 拿
// 来追 ghost text 队列。
export type AgentEvent =
  | { readonly type: 'iteration_started'; readonly iter: number }
  | { readonly type: 'llm_chunk'; readonly text: string }
  | { readonly type: 'tool_started'; readonly name: string; readonly args: unknown; readonly progressLabel?: string }
  | { readonly type: 'tool_completed'; readonly result: ToolResult }
  | { readonly type: 'capability_state_changed'; readonly states: readonly CapabilityState[] }
  | { readonly type: 'ghosts_received'; readonly items: readonly string[] }
  | { readonly type: 'retrying'; readonly attempt: number }
  | { readonly type: 'iteration_completed'; readonly iter: number }
  | { readonly type: 'final_text'; readonly text: string }
  | { readonly type: 'error'; readonly message: string };
