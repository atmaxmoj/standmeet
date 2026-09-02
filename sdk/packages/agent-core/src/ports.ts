// ports.ts —— 3 DI ports. agent-core only programs against these
// interfaces internally; after H.10 the agent loop moved into backend
// (eino ADK) and the browser is downgraded to an event consumer:
// VisitorTurnAgent only needs PromptSource + TurnStreamer + EventObserver,
// so swapping host (prod browser HTTP adapter / future IM bridge) only
// means writing these 3 adapters.

import type { AgentEvent, AgentTurnEvent, Message } from './types.js';

// PromptSource —— fetches system prompt fragment text. prod goes through
// HTTP GET /api/v1/prompts/{id}; eval goes through fs.readFile.
export interface PromptSource {
  load(id: string): Promise<string>;
}

// EventObserver —— receives every agent loop transition. prod is a React
// useReducer/store; eval is a transcript printer (colored stdout / JSONL).
// Kept to a single method for simplicity; the caller does its own routing.
export interface EventObserver {
  onEvent(event: AgentEvent): void;
}

// TurnRequest —— H.10: the wire payload the browser sends to run one whole
// turn of visitor chat. Maps directly onto the body shape of backend POST
// /api/v1/agent/turn. conversationID lets backend tools (calendar_book /
// persist) find the right chat row; an empty string makes downstream UUID
// parsing fail for things like BookMeeting.
export interface TurnRequest {
  readonly system: string;
  readonly userMessage: string;
  readonly conversationID: string;
  readonly history: readonly Message[];
  // docContext —— which doc the visitor is looking at when asking
  // (reader/wiki/output page, or wherever the floating panel is docked).
  // backend injects it into the instruction so pronoun references
  // ("this page" / "this one") can be resolved.
  readonly docContext?: DocContext;
}

// DocContext —— minimal identifier for the document the visitor is
// currently on (lets the AI resolve pronoun references).
export interface DocContext {
  readonly title: string;
  readonly path: string;
  readonly genre: string; // wiki | output | writing
}

// TurnStreamer —— H.10: agent-core's single exit point. The browser calls
// it once and gets a whole turn's worth of events streamed back; backend
// (eino ADK) owns the entire LLM <-> tool loop plus summarization.
export interface TurnStreamer {
  stream(req: TurnRequest): AsyncIterable<AgentTurnEvent>;
}
