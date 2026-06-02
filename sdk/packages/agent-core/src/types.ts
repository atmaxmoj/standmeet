// types.ts —— shared agent core types, kept stable across hosts so any
// LLMStreamer / ToolDispatcher / EventObserver impl knows the contract.

export interface CapabilityState {
  readonly id: string;
  readonly enabled: boolean;
  readonly quota_remaining?: number;
  readonly policy_summary?: string;
  readonly extra?: unknown;
}

// Tool call/result envelope —— matches pi-ai shape loosely so existing
// providers/adapters can interop without translation layer.
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

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
// Message.tool_calls 上随 history 来回。跟 ToolCall (live dispatcher 输入)
// 同形但语义不同：ToolCall 是"现在要调的"，ToolCallRef 是"上轮调过的"。
export interface ToolCallRef {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

// AgentEvent —— observer receives one per state transition. Names align
// with eval harness scenarios.
export type AgentEvent =
  | { readonly type: 'iteration_started'; readonly iter: number }
  | { readonly type: 'llm_chunk'; readonly text: string }
  | { readonly type: 'llm_tool_request'; readonly call: ToolCall }
  | { readonly type: 'tool_started'; readonly name: string }
  | { readonly type: 'tool_completed'; readonly result: ToolResult }
  | { readonly type: 'capability_state_changed'; readonly states: readonly CapabilityState[] }
  | { readonly type: 'iteration_completed'; readonly iter: number }
  | { readonly type: 'final_text'; readonly text: string }
  | { readonly type: 'error'; readonly message: string };
