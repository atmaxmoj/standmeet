// @standmeet/agent-core —— visitor chat agent loop, host-agnostic.
// After H.10 the loop lives in backend (eino ADK); the browser is a thin
// event consumer, wiring the 3 ports (prompts / turn / observer) to run
// VisitorTurnAgent.

export { VisitorTurnAgent } from './agent-turn.js';
// TURN_STOP_REASONS is a **value**, not a type: the SSE parsing side uses it
// to check "is this stop reason known?".
// This is the only list — adding a new stop reason just means editing it
// here (see the note in types.ts).
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
