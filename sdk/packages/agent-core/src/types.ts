// types.ts —— shared agent core types, kept stable across hosts so any
// TurnStreamer / EventObserver impl knows the contract.

export interface CapabilityState {
  readonly id: string;
  readonly enabled: boolean;
  // title —— 透传 MCP 工具的人类可读显示名（#109/#110 dock 按钮 label 用）。没实现则缺省。
  readonly title?: string;
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
// Ghost-steering P4：`ghost`（单数）—— done 之后 backend policy 出**至多一个** steering ghost
// (替代旧的 `ghosts` 3 条 followup 队列)；字段对齐后端 GhostFrame。
export type AgentTurnEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool_started'; readonly id: string; readonly name: string; readonly args: unknown; readonly progressLabel?: string }
  | { readonly type: 'tool_completed'; readonly name: string; readonly result: string }
  | { readonly type: 'ghost'; readonly text: string; readonly target_waypoint?: string; readonly follows_from?: string; readonly ghost_id?: string; readonly is_bridge?: boolean }
  | { readonly type: 'retrying'; readonly attempt: number }
  | { readonly type: 'done'; readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

// AgentEvent —— observer receives one per state transition. Names align
// with eval harness scenarios. Ghost-steering P4：`ghost_received`（单数）——
// VisitorTurnAgent 收到 SSE `ghost` 事件时往 observer 发；UI 拿来把输入框 ghost
// 换成 policy 那条（不是队列 append）。
export type AgentEvent =
  | { readonly type: 'iteration_started'; readonly iter: number }
  | { readonly type: 'llm_chunk'; readonly text: string }
  | { readonly type: 'tool_started'; readonly name: string; readonly args: unknown; readonly progressLabel?: string }
  | { readonly type: 'tool_completed'; readonly result: ToolResult }
  | { readonly type: 'capability_state_changed'; readonly states: readonly CapabilityState[] }
  | { readonly type: 'ghost_received'; readonly text: string; readonly targetWaypoint?: string; readonly ghostId?: string }
  | { readonly type: 'retrying'; readonly attempt: number }
  | { readonly type: 'iteration_completed'; readonly iter: number }
  | { readonly type: 'final_text'; readonly text: string }
  // turn_finished —— 这一轮**怎么**结束的。三种收场里只有 max_tokens 意味着话没说完：
  // 流正常关闭，正文停在半句上。这个值从 provider 一路传到浏览器，以前在 SSE 解析完
  // 就被扔了（尾帧只用来置 sawDone），于是半句话冒充了完整答案（F-A-34）。
  | { readonly type: 'turn_finished'; readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' }
  | { readonly type: 'error'; readonly message: string };
