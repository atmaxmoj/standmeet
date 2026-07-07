// mock-llm-script.ts —— direct the test llm-gateway to emit a specific
// tool call (or final reply text) on its next /v1/messages turn.
//
// Backed by a single-slot in-memory queue on mock-stack/llm-gateway. The
// owner's ai_endpoint column points the backend's anthropic provider at
// this gateway in dev/e2e; on each /v1/messages POST it pops the queue
// and emits tool_use (or text). Tests POST {name, args} / {text} before
// sending a chat message.

import type { APIRequestContext } from '@playwright/test';

import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';
import type { VisitorSession } from '@/fixtures/visitor';

const GATEWAY = process.env['LLM_GATEWAY_URL'] ?? 'http://localhost:9300';

/** scriptTag —— hidden [[s:KEY]] token to append to a fired turn message so the
 *  mock binds THIS turn to the keyed script (scriptMockToolCall key). Request-
 *  level, so an overlapping/trailing turn from another test can't consume it.
 *  Cosmetically visible in the transcript (like the delay markers); tests that
 *  key a turn don't assert that turn's displayed text. */
export function scriptTag(key: string): string {
  return ` [[s:${key}]]`;
}

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
  // key —— keyed registration: only the turn carrying the matching scriptTag(key)
  // token in its message consumes this script. Omit = wildcard, any turn with no
  // token (legacy single-slot). Pass it (a unique `test#turn` label) when another
  // turn could overlap and steal the slot — e.g. an ask_visitor card whose submit
  // fires a trailing turn. Embed the SAME key in the turn message via scriptTag.
  key?: string;
}

/** Tell the mock provider: when the turn tagged with this key (or any turn, if
 *  no key) is next called with tools available, invoke this tool before
 *  replying. Pair with scriptTag(key) in the fired message. */
export async function scriptMockToolCall(
  request: APIRequestContext, call: ScriptedToolCall,
): Promise<void> {
  const data = { name: call.name, args: call.args, key: call.key ?? '' };
  const res = await request.post(`${GATEWAY}/__mock/inference/next_tool`, { data });
  if (res.status() !== 200) {
    throw new Error(`script next_tool: ${res.status()}`);
  }
}

/** Tell the mock provider: emit this text as the final reply on the
 *  next agent step (single-slot queue, consumed once). Used by G-X to
 *  verify markdown / katex / mermaid in answer-body renders correctly
 *  through ConversationDeck → AnswerParas → ChatMarkdown. */
export async function scriptMockReplyText(
  request: APIRequestContext, text: string,
): Promise<void> {
  const res = await request.post(
    `${GATEWAY}/__mock/inference/next_reply`, { data: { text } },
  );
  if (res.status() !== 200) {
    throw new Error(`script next_reply: ${res.status()}`);
  }
}

/** Tell the mock provider: on the NEXT GhostPolicy call (the non-stream turn whose
 *  system prompt carries "ONE GHOST MESSAGE"), return this JSON body — an object
 *  {text,target_waypoint,follows_from,is_bridge} to emit a ghost, or null for
 *  silence. Unscripted policy calls default to null (no ghost). Pair with the
 *  chat turn that should produce the ghost. */
export async function scriptMockGhost(
  request: APIRequestContext, ghost: Record<string, unknown> | null,
): Promise<void> {
  const res = await request.post(
    `${GATEWAY}/__mock/inference/next_ghost`, { data: { body: ghost } },
  );
  if (res.status() !== 200) {
    throw new Error(`script next_ghost: ${res.status()}`);
  }
}

/** Tell the mock provider: fail every /v1/messages with 500 until a normal
 *  reply/tool is scripted again. Simulates a third-party LLM outage — used to
 *  verify a failed turn does NOT consume the session's turn quota. */
export async function scriptMockError(
  request: APIRequestContext,
): Promise<void> {
  const res = await request.post(`${GATEWAY}/__mock/inference/next_error`, { data: {} });
  if (res.status() !== 200) {
    throw new Error(`script next_error: ${res.status()}`);
  }
}

/** Run one visitor turn through the pi-agent-core-equivalent loop in
 *  Node, drain the response. Most calendar.book specs care about side
 *  effects (mock GCal events, tool-spec assembly) rather than the exact
 *  reply text, so the drained-loop return shape avoids brittle regex
 *  assertions on whatever the mock LLM happened to say.
 *
 *  G-Y.6: backend's POST /messages route is gone; visitor-chat-loop.ts
 *  drives /agent/turn. #28 起 backend 自己在流末端 sink 进 conversation 表,
 *  admin transcript 照样有这段交换(fixture 不再 POST /dialogs)。 */
export async function sendAndDrain(
  request: APIRequestContext,
  sess: VisitorSession,
  msg: string,
): Promise<void> {
  await runVisitorChatTurn(request, sess, msg);
}
