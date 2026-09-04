// types.ts —— shared agent core types, kept stable across hosts so any
// TurnStreamer / EventObserver impl knows the contract.

export interface CapabilityState {
  readonly id: string;
  readonly enabled: boolean;
  // title —— passthrough of the MCP tool's human-readable display name
  // (used for the dock button label in #109/#110). Optional if not implemented.
  readonly title?: string;
  readonly quota_remaining?: number;
  readonly policy_summary?: string;
  readonly extra?: unknown;
}

// ToolResult —— envelope for a tool call's result. matches pi-ai shape loosely so
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
// id the result is for). No marker strings — fields are typed, translating
// 1:1 across the wire to backend eino.
export interface Message {
  readonly role: 'user' | 'assistant' | 'system' | 'tool';
  readonly content: string;
  readonly tool_calls?: readonly ToolCallRef[];
  readonly tool_call_id?: string;
}

// ToolCallRef —— small record of one tool_use call made within an
// assistant turn, attached to Message.tool_calls and carried back and
// forth with history (a prior turn's call, fed back to backend as context).
export interface ToolCallRef {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

// AgentTurnEvent —— H.10: one new-wire SSE event. The shape the pi side
// receives from /api/v1/agent/turn; TurnStreamer yields the whole set of
// events for one turn.
// Ghost-steering P4: `ghost` (singular) —— after done, backend policy emits
// **at most one** steering ghost (replacing the old `ghosts` 3-item
// followup queue); fields align with the backend GhostFrame.
export type AgentTurnEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool_started'; readonly id: string; readonly name: string; readonly args: unknown; readonly progressLabel?: string }
  | { readonly type: 'tool_completed'; readonly name: string; readonly result: string }
  | { readonly type: 'ghost'; readonly text: string; readonly target_waypoint?: string; readonly follows_from?: string; readonly ghost_id?: string; readonly is_bridge?: boolean }
  | { readonly type: 'retrying'; readonly attempt: number }
  | { readonly type: 'done'; readonly stopReason: TurnStopReason }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

// TurnStopReason —— how a turn ends. Three come from the model (finished
// speaking / still wants to call a tool / ran out of budget).
// **claim_unbacked is the product's own judgment**: this turn's answer says
// it accomplished something, but the turn has no receipt for that
// (F-A-37). It goes through the same channel as the first three, because
// the consumer already decides how to wrap up the turn based on stop reason.
// TURN_STOP_REASONS —— **this is the list itself**; the type is derived from it.
//
// Why an array instead of a hand-written union (continuing UX-84 / F-A-35):
// the parsing side has a `normStop` that collapses unknown values down to
// `end_turn`, and its comment says "adding a new stop reason must be added
// to this line too".
// **I still missed it today when adding `no_answer`** — backend judged it
// correctly, the frontend mapping was written too, but this hop in between
// silently rewrote it to "finished normally", so the hint never rendered
// at all, and no layer errored.
//
// A comment can't prevent this kind of gap
// ([[structure-means-no-responsibility-class]]). After switching to a
// single list, `normStop` uses `includes` to check against this same list:
// **adding a value only requires editing here, the parsing side follows
// automatically**.
export const TURN_STOP_REASONS = [
  'end_turn',
  'tool_use',
  'max_tokens',
  // The two the product judges itself (not given by the model):
  'claim_unbacked', // Says it accomplished something, but has no receipt (F-A-37)
  'no_answer', // Didn't answer at all, and there's no salvaging it (F-A-35)
  'deadline', // Ran out of time, missed even the last-resort save (F-A-44)
] as const;

export type TurnStopReason = (typeof TURN_STOP_REASONS)[number];

// AgentEvent —— observer receives one per state transition. Names align
// with eval harness scenarios. Ghost-steering P4: `ghost_received`
// (singular) —— VisitorTurnAgent sends this to the observer when it
// receives an SSE `ghost` event; the UI uses it to replace the input box's
// ghost with the policy one (not queue-append).
export type AgentEvent =
  | { readonly type: 'iteration_started'; readonly iter: number }
  | { readonly type: 'llm_chunk'; readonly text: string }
  | { readonly type: 'tool_started'; readonly name: string; readonly args: unknown; readonly progressLabel?: string }
  | { readonly type: 'tool_completed'; readonly result: ToolResult }
  | { readonly type: 'capability_state_changed'; readonly states: readonly CapabilityState[] }
  | { readonly type: 'ghost_received'; readonly text: string; readonly targetWaypoint?: string; readonly ghostId?: string }
  | { readonly type: 'retrying'; readonly attempt: number }
  | { readonly type: 'iteration_completed'; readonly iter: number }
  // answer_recovered —— a mid-stream transport drop was healed: the backend
  // finished on its detached context and persisted the turn, and this is that
  // persisted answer, pulled back without re-running the turn. The consumer
  // replaces whatever partial text streamed in before the drop with this
  // authoritative text (and clears the cut-error it would otherwise show).
  | { readonly type: 'answer_recovered'; readonly text: string }
  | { readonly type: 'final_text'; readonly text: string }
  // turn_finished —— **how** this turn ended. Of the stop reasons, only
  // max_tokens means the reply is unfinished: the stream closes cleanly
  // but the text stops mid-sentence. This value travels all the way from
  // the provider to the browser; it used to get discarded right after SSE
  // parsing (the trailing frame was only used to set sawDone), so a
  // half-sentence passed itself off as a complete answer (F-A-34).
  | { readonly type: 'turn_finished'; readonly stopReason: TurnStopReason }
  | { readonly type: 'error'; readonly message: string };
