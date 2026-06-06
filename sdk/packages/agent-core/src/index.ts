// @standmeet/agent-core —— visitor chat agent loop, host-agnostic.
// H.10 后 loop 在 backend (eino ADK)；浏览器是 thin event consumer，
// 注 3 ports (prompts / turn / observer) 跑 VisitorTurnAgent。

export { VisitorTurnAgent } from './agent-turn.js';
export type {
  SendTurnOptions,
  VisitorTurnAgentConfig,
  VisitorTurnAgentPorts,
} from './agent-turn.js';
export type {
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
} from './types.js';
