// mock-llm-script.ts —— direct the test llm-gateway to emit a specific tool call
// (or final reply text) on a turn.
//
// **Keyword KV.** Each scriptMock* call registers value under a key of the form
// `<testId>-<n>`: the fixture stamps the CURRENT test's id (test.info().testId,
// unique per test) as the prefix, and an auto-incrementing per-test counter as
// the suffix. It returns the `[[s:key]]` tag; the caller embeds that tag in the
// turn message it sends. The mock matches by Contains, so only a request carrying
// THIS test's keyword consumes this registration.
//
// Isolation is by construction: the testId prefix means two tests can never
// collide, and the counter means two registrations within one test can't either
// (unless a test re-embeds a stale tag by hand). No owner/session/turn coupling,
// no per-spec reset — a leaked (unconsumed) registration sits under a keyword no
// other request contains.

import { test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

import { runVisitorChatTurn } from '@/fixtures/visitor-chat-loop';
import type { VisitorSession } from '@/fixtures/visitor';

const GATEWAY = process.env['LLM_GATEWAY_URL'] ?? 'http://localhost:9300';

// per-test suffix counter → distinct keys for multiple registrations in one test.
const suffixByTest = new Map<string, number>();

// nextScriptKey —— `<testId>-<n>`. testId (unique per test) makes cross-test
// collision impossible; the counter makes within-test collision impossible.
function nextScriptKey(): string {
  const id = test.info().testId.replace(/[^a-zA-Z0-9]/g, '');
  const n = suffixByTest.get(id) ?? 0;
  suffixByTest.set(id, n + 1);
  return `${id}-${n}`;
}

// scriptTag —— the `[[s:KEY]]` wrapper embedded in a turn message so the mock's
// Contains-match binds that turn to a keyed script. The wrapper lets the mock
// strip the keyword from the corpus_search query (markers.go).
function scriptTag(key: string): string {
  return ` [[s:${key}]]`;
}

export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
}

// postScript —— the ONE chokepoint: mint a unique per-test key, register value
// under it, and hand back the tag to embed. Every scripting endpoint routes here,
// so a registration is ALWAYS keyed by the current test — no caller can register
// an unkeyed (leak-prone) script, and a new endpoint can't forget the key.
async function postScript(
  request: APIRequestContext, endpoint: string, payload: Record<string, unknown>,
): Promise<string> {
  const key = nextScriptKey();
  const res = await request.post(
    `${GATEWAY}/__mock/inference/${endpoint}`, { data: { ...payload, key } },
  );
  if (res.status() !== 200) {
    throw new Error(`script ${endpoint}: ${res.status()}`);
  }
  return scriptTag(key);
}

/** Register a scripted tool call for this test. Returns the `[[s:key]]` tag —
 *  embed it in the turn message that should invoke the tool. Only a request
 *  containing that tag consumes this registration. */
export async function scriptMockToolCall(
  request: APIRequestContext, call: ScriptedToolCall,
): Promise<string> {
  return postScript(request, 'next_tool', { name: call.name, args: call.args });
}

/** Register a scripted final reply for this test (used by G-X to verify markdown /
 *  katex / mermaid render through ConversationDeck → AnswerParas → ChatMarkdown).
 *  Returns the `[[s:key]]` tag to embed in the turn message. */
export async function scriptMockReplyText(
  request: APIRequestContext, text: string,
): Promise<string> {
  return postScript(request, 'next_reply', { text });
}

/** Register a scripted GhostPolicy body for this test — an object
 *  {text,target_waypoint,follows_from,is_bridge} to emit a ghost, or null for
 *  silence. Returns the `[[s:key]]` tag to embed in the turn that should produce
 *  the ghost. Unscripted policy calls default to null (no ghost). */
export async function scriptMockGhost(
  request: APIRequestContext, ghost: Record<string, unknown> | null,
): Promise<string> {
  return postScript(request, 'next_ghost', { body: ghost });
}

/** Make the mock fail every /v1/messages whose text carries the returned tag with
 *  500, simulating a third-party LLM outage — used to verify a failed turn does
 *  NOT consume the session's turn quota. Returns the `[[s:key]]` tag to embed. */
export async function scriptMockError(
  request: APIRequestContext,
): Promise<string> {
  return postScript(request, 'next_error', {});
}

/** Run one visitor turn through the backend agent loop, drain the response. Most
 *  calendar.book specs care about side effects (mock GCal events, tool-spec
 *  assembly) rather than exact reply text, so the drained-loop return shape
 *  avoids brittle regex assertions on whatever the mock LLM happened to say. */
export async function sendAndDrain(
  request: APIRequestContext,
  sess: VisitorSession,
  msg: string,
): Promise<void> {
  await runVisitorChatTurn(request, sess, msg);
}
