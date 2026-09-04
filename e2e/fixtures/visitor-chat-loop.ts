// visitor-chat-loop.ts —— H.10: after the backend agent loop takes over, the Node-side
// fixture no longer drives the LLM ↔ tool loop; it switches to a single POST /api/v1/agent/turn
// receiving the full set of SSE events (text / tool_started / tool_completed / done / error)
// → accumulating the final text.
//
// Same shape as the browser's pi-agent-core (VisitorTurnAgent after H.10): a thin event
// consumer. Since #28 the backend itself sinks this turn (with cited / tool_calls) into the
// conversation table at the end of the /agent/turn stream, and the fixture no longer POSTs /dialogs
// —— matching the real frontend; failures/quota errors pass status through as-is for the spec to assert.

import type { APIRequestContext } from '@playwright/test';

import type { VisitorSession, BYOAIVisitorSession } from '@/fixtures/visitor';

export interface FakeAPIResponse {
  status: () => number;
  body: () => Promise<Buffer>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

// runVisitorChatTurn —— drive one visitor question through backend
// /agent/turn endpoint. Since #28 /agent/turn itself sinks this turn into the conversation
// table (quota is also checked at its entry), and the fixture no longer POSTs /dialogs —— matching
// the real frontend. Returns a fake APIResponse mimicking the legacy /messages surface: on success
// status()=200, text()=final assistant text; pre-stream errors (quota 403 / auth) pass status + body
// through as-is for the spec to assert (turn-quota's 3rd turn 403 turn_quota_reached goes this way).
export async function runVisitorChatTurn(
  request: APIRequestContext, sess: VisitorSession, question: string,
): Promise<FakeAPIResponse> {
  const system = await fetchSystemPrompt(sess);
  const headers = await buildHeaders(sess);
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers, data: {
      system, user_message: question,
      conversation_id: sess.conversation_id,
      history: [],
    },
  });
  const status = res.status();
  if (status !== 200) {
    return makeFakeResponse(status, await res.text());
  }
  const body = await res.body();
  return makeFakeResponse(200, accumulateAgentEvents(body.toString('utf-8')));
}

interface AgentEventFrame {
  event: string;
  data: Record<string, unknown>;
}

// accumulateAgentEvents —— SSE frames → final assistant text. An error frame throws
// (this path is taken when the mock injects a fault / force-final also fails), so a failed turn's spec can assert.
// citation / tool_calls are not accumulated here: since #28 the backend itself extracts them from the stream end and persists them.
function accumulateAgentEvents(raw: string): string {
  let text = '';
  for (const frame of splitFrames(raw)) {
    if (frame.event === 'text') {
      text += stringOr(frame.data['delta'], '');
    } else if (frame.event === 'error') {
      throw new Error(stringOr(frame.data['message'], 'agent error'));
    }
  }
  return text;
}

function splitFrames(raw: string): AgentEventFrame[] {
  const out: AgentEventFrame[] = [];
  for (const chunk of raw.split('\n\n')) {
    const frame = parseFrame(chunk);
    if (frame !== null) out.push(frame);
  }
  return out;
}

function parseFrame(raw: string): AgentEventFrame | null {
  let ev = ''; let dt = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) ev = line.slice(7).trim();
    else if (line.startsWith('data: ')) dt = line.slice(6).trim();
  }
  if (ev === '') return null;
  return { event: ev, data: safeJson(dt) as Record<string, unknown> };
}

function makeFakeResponse(status: number, text: string): FakeAPIResponse {
  return {
    status: () => status,
    body: () => Promise.resolve(Buffer.from(text, 'utf-8')),
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(safeJson(text)),
  };
}

async function fetchSystemPrompt(sess: VisitorSession): Promise<string> {
  const parts: string[] = [];
  for (const id of sess.system_prompt_part_ids ?? []) {
    const res = await fetch(`${BACKEND}/api/v1/prompts/${id}`);
    if (!res.ok) continue;
    parts.push(await res.text());
  }
  if (sess.system_prompt_persona) parts.push(sess.system_prompt_persona);
  return parts.join('\n\n');
}

async function buildHeaders(sess: VisitorSession): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    Authorization: `Bearer ${sess.session_token}`,
    'Content-Type': 'application/json',
  };
  const byoai = sess as Partial<BYOAIVisitorSession>;
  if (!byoai.byoai_key || !byoai.byoai_provider) return base;
  const wrapped = await wrapBYOAIKey(byoai.byoai_key, sess.session_token);
  return {
    ...base,
    'X-BYOAI-Provider': byoai.byoai_provider,
    'X-BYOAI-Key': wrapped,
    'X-BYOAI-Endpoint': byoai.byoai_endpoint ?? '',
    'X-BYOAI-Model': byoai.byoai_model ?? '',
  };
}

async function wrapBYOAIKey(plain: string, sessionToken: string): Promise<string> {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey(
    'raw', enc.encode(sessionToken), 'HKDF', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: new Uint8Array(0), info: enc.encode('standmeet-byoai-v1'),
    },
    ikm, 256,
  );
  const aesKey = await crypto.subtle.importKey(
    'raw', bits, { name: 'AES-GCM' }, false, ['encrypt'],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, enc.encode(plain),
  );
  const blob = new Uint8Array(nonce.byteLength + ct.byteLength);
  blob.set(nonce, 0);
  blob.set(new Uint8Array(ct), nonce.byteLength);
  return base64URLNoPad(blob);
}

function base64URLNoPad(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
