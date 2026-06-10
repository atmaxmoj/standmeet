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

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Tell the mock provider: when next called with tools available,
 *  invoke this tool with these args before replying. */
export async function scriptMockToolCall(
  request: APIRequestContext, call: ScriptedToolCall,
): Promise<void> {
  const res = await request.post(`${GATEWAY}/__mock/inference/next_tool`, { data: call });
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
