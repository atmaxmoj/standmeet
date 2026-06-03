// @standmeet/agent-core —— visitor chat agent loop, host-agnostic.
// Inject 5 ports (prompts / capabilities / llm / tools / observer);
// same loop runs in prod browser, eval harness, IM bridge, etc.

export { VisitorAgent } from './agent.js';
export type {
  SendOptions,
  ToolSpecRegistry,
  VisitorAgentConfig,
  VisitorAgentPorts,
} from './agent.js';
export { VisitorTurnAgent } from './agent-turn.js';
export type {
  SendTurnOptions,
  VisitorTurnAgentConfig,
  VisitorTurnAgentPorts,
} from './agent-turn.js';
export type {
  CapabilityStateSource,
  EventObserver,
  LLMStreamRequest,
  LLMStreamEvent,
  LLMStreamer,
  LLMToolSpec,
  PromptSource,
  ToolDispatcher,
  TurnRequest,
  TurnStreamer,
} from './ports.js';
export type {
  AgentEvent,
  AgentTurnEvent,
  CapabilityState,
  Message,
  ToolCall,
  ToolCallRef,
  ToolResult,
} from './types.js';
