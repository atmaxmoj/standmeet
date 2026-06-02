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

/** Run one visitor turn through the pi-agent-core-equivalent loop in
 *  Node, drain the response. Most calendar.book specs care about side
 *  effects (mock GCal events, tool-spec assembly) rather than the exact
 *  reply text, so the drained-loop return shape avoids brittle regex
 *  assertions on whatever the mock LLM happened to say.
 *
 *  G-Y.6: backend's POST /messages route is gone; visitor-chat-loop.ts
 *  reimplements the agent loop in fixture-land, posting /dialogs at the
 *  end so admin transcripts still record the exchange. */
export async function sendAndDrain(
  request: APIRequestContext,
  sess: VisitorSession,
  msg: string,
): Promise<void> {
  await runVisitorChatTurn(request, sess, msg);
}
