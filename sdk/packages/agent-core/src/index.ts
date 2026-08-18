// @standmeet/agent-core —— visitor chat agent loop, host-agnostic.
// H.10 后 loop 在 backend (eino ADK)；浏览器是 thin event consumer，
// 注 3 ports (prompts / turn / observer) 跑 VisitorTurnAgent。

export { VisitorTurnAgent } from './agent-turn.js';
// TURN_STOP_REASONS 是**值**不是类型：SSE 解析那侧要用它查「这个收场认不认得」。
// 名单只有这一份，加一种停止原因改那里就够（见 types.ts 的说明）。
export { TURN_STOP_REASONS } from './types.js';
export type {
  SendTurnOptions,
  VisitorTurnAgentConfig,
  VisitorTurnAgentPorts,
} from './agent-turn.js';
export type {
  DocContext,
  EventObserver,
  PromptSource,
  TurnRequest,
  TurnStreamer,
} from './ports.js';
export type {
  AgentEvent,
  AgentTurnEvent,
  CapabilityState,
  Message,
  ToolCallRef,
  ToolResult,
  TurnStopReason,
} from './types.js';
