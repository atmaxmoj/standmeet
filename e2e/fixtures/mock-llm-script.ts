// mock-llm-script.ts —— direct the mock inference provider to attempt a
// specific tool call on its next agent-loop step.
//
// Backed by a single-slot in-memory queue on job-board-mock at
// /__mock/inference/next_tool. Backend's MockProvider polls
// /__mock/inference/take_next_tool before each agent step (only when
// INFERENCE_MOCK_SCRIPT_URL is set in compose). Tests POST the desired
// {name, args}, then send a chat message, then assert on the chat
// transcript + mock GCal events.

import type { APIRequestContext } from '@playwright/test';

const MOCK = process.env['MOCK_BASE_URL'] ?? 'http://localhost:9000';

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** Tell the mock provider: when next called with tools available,
 *  invoke this tool with these args before replying. */
export async function scriptMockToolCall(
  request: APIRequestContext, call: ScriptedToolCall,
): Promise<void> {
  const res = await request.post(`${MOCK}/__mock/inference/next_tool`, { data: call });
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
    `${MOCK}/__mock/inference/next_reply`, { data: { text } },
  );
  if (res.status() !== 200) {
    throw new Error(`script next_reply: ${res.status()}`);
  }
}

/** sendMessage + drain SSE stream. Most calendar.book specs care about
 *  side effects (mock GCal events, tool-spec assembly) rather than the
 *  exact reply text, so a drained-stream return shape avoids brittle
 *  regex assertions on whatever the mock LLM happened to say. */
export async function sendAndDrain(
  request: APIRequestContext,
  sess: { conversation_id: string; session_token: string },
  msg: string,
): Promise<void> {
  const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/messages`,
    {
      headers: { Authorization: `Bearer ${sess.session_token}` },
      data: { content: msg },
    },
  );
  await res.body();
}
