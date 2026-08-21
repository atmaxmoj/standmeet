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

/** Register several tool calls the model emits **in one message** — what a real
 *  provider does routinely and what the mock could not express until now. Pass two
 *  calls with the same `name` to reproduce the shape where results can no longer be
 *  attributed to calls (F-S-1). Returns the `[[s:key]]` tag to embed in the turn. */
export async function scriptMockParallelToolCalls(
  request: APIRequestContext, calls: readonly ScriptedToolCall[],
): Promise<string> {
  const [first, ...rest] = calls;
  if (first === undefined) throw new Error('scriptMockParallelToolCalls: need at least one call');
  return postScript(request, 'next_tool', {
    name: first.name, args: first.args,
    also: rest.map((c) => ({ name: c.name, args: c.args })),
  });
}

/** Register a scripted final reply for this test (used by G-X to verify markdown /
 *  katex / mermaid render through ConversationDeck → AnswerParas → ChatMarkdown).
 *  Returns the `[[s:key]]` tag to embed in the turn message. */
export async function scriptMockReplyText(
  request: APIRequestContext, text: string, opts?: { delayMs?: number },
): Promise<string> {
  return postScript(request, 'next_reply', { text, delay_ms: opts?.delayMs ?? 0 });
}

/** Register a reply that ends because the model's OUTPUT BUDGET ran out — the other
 *  way a generation finishes. It is not an error: the stream closes normally, the text
 *  just stops mid-sentence. Everything else in the loop treats it like a completed
 *  answer, which is what let a half clause render as finished (F-A-34).
 *  Returns the `[[s:key]]` tag to embed in the turn message. */
export async function scriptMockReplyTruncated(
  request: APIRequestContext, text: string,
): Promise<string> {
  return postScript(request, 'next_reply', { text, stop: 'max_tokens' });
}

/** Register a scripted GhostPolicy body for this test — an object
 *  {text,target_waypoint,follows_from,is_bridge} to emit a ghost, or null for
 *  silence. Returns the `[[s:key]]` tag to embed in the turn that should produce
 *  the ghost. Unscripted policy calls default to null (no ghost). */
export async function scriptMockGhost(
  request: APIRequestContext, ghost: Record<string, unknown> | null,
  opts?: { delayMs?: number },
): Promise<string> {
  return postScript(request, 'next_ghost', {
    body: ghost, delay_ms: opts?.delayMs ?? 0,
  });
}

/** Make the mock fail every /v1/messages whose text carries the returned tag with
 *  500, simulating a third-party LLM outage — used to verify a failed turn does
 *  NOT consume the session's turn quota. Returns the `[[s:key]]` tag to embed. */
export async function scriptMockError(
  request: APIRequestContext,
): Promise<string> {
  return postScript(request, 'next_error', {});
}

/** Make the mock answer every /v1/messages carrying the returned tag with **429 +
 *  `Retry-After: <seconds>`** — a provider saying "not this fast", not "I'm broken".
 *
 *  That distinction is the whole point of agent-loop-robustness checks 4/5: a 500 is
 *  a fault, a 429 carries an interval the provider explicitly asked for, and retrying
 *  before it is what deepens a real ban. Returns the `[[s:key]]` tag to embed. */
export async function scriptMockRateLimit(
  request: APIRequestContext, retryAfterSeconds: number,
): Promise<string> {
  return postScript(request, 'next_rate_limit', {
    retry_after_seconds: retryAfterSeconds,
  });
}

/** What the gateway actually received for a turn carrying `tag` — the only way to
 *  assert WHICH upstream configuration served it. `model` is the request's model
 *  (give each provider row a distinct one); `auth_prefix` is the first 8 chars of
 *  the credential (enough to tell two keys apart, not enough to be a leak);
 *  `path` distinguishes providers configured on different base paths.
 *
 *  Looked up BY TAG, not "the last request": under parallel workers a global last
 *  belongs to whoever ran most recently, and the resulting red looks like your
 *  feature broke. `found` is false when no recorded request carried the tag. */
export interface GatewayRequest {
  path: string;
  model: string;
  auth_prefix: string;
  stream: boolean;
  found: boolean;
  /** Did that request's messages carry the `contains` needle? False when no
   *  needle was asked for. Use it to assert that something reached the model's
   *  context — the one place a fact like "the visitor cancelled on the card"
   *  is visible at all (F-B-9). */
  contains: boolean;
}

/** Empty the gateway's request ring.
 *
 *  Needed because a script tag is `<testId>-<n>` — **stable across runs of the
 *  same spec** — while the ring outlives the run. Without this, a query can hit
 *  the record left by the previous run and the assertion stops being able to
 *  fail: on F-B-9 I removed the fix and the spec still passed. */
export async function resetGatewayRequests(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${GATEWAY}/__mock/inference/reset_requests`);
  if (res.status() !== 200) throw new Error(`reset_requests: ${res.status()}`);
}

/** Did ANY request in this run carry this text? Tag-free on purpose.
 *
 *  Some model calls belong to no turn: **compaction** is its own call, carrying the
 *  messages being compacted plus the summariser's instruction. Asking by tag returns
 *  the turn's own call (later in the ring), so `contains` ends up judging the wrong
 *  request — that is how F-D-10's guard went red on my query rather than on the
 *  product. Use this when the question is "did this sentence go to the model at all". */
export async function gatewayRequestExists(
  request: APIRequestContext, contains: string,
): Promise<boolean> {
  const res = await request.get(
    `${GATEWAY}/__mock/inference/any_request?contains=${encodeURIComponent(contains)}`,
  );
  if (res.status() !== 200) throw new Error(`any_request: ${res.status()}`);
  return ((await res.json()) as GatewayRequest).found;
}

export async function lastGatewayRequest(
  request: APIRequestContext, tag: string, contains = '',
): Promise<GatewayRequest> {
  // The caller holds `[[s:KEY]]`; the recorder matches on substring, so the raw
  // tag works as-is.
  const needle = contains === '' ? '' : `&contains=${encodeURIComponent(contains)}`;
  const res = await request.get(
    `${GATEWAY}/__mock/inference/last_request?tag=${encodeURIComponent(tag.trim())}${needle}`,
  );
  if (res.status() !== 200) throw new Error(`last_request: ${res.status()}`);
  return await res.json() as GatewayRequest;
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
