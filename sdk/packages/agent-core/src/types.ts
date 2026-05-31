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

// Conversation message —— minimal shape (no provider-specific blocks).
export interface Message {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
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
