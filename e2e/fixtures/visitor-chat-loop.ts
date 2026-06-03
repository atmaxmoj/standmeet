// visitor-chat-loop.ts —— H.10: backend agent loop 接管之后，Node 端
// fixture 不再 driver LLM ↔ tool 循环；改成单 POST /api/v1/agent/turn
// 收 SSE 整套事件 (text / tool_started / tool_completed / done / error)
// → 累 final text → /dialogs commit。
//
// 跟浏览器 pi-agent-core (H.10 后 VisitorTurnAgent) 同形态：thin event
// consumer。Cited tracking 走 tool_completed (corpus_read result 的
// path/genre)，老 mechanism 不变。

import type { APIRequestContext } from '@playwright/test';

import type { VisitorSession, BYOAIVisitorSession } from '@/fixtures/visitor';

export interface FakeAPIResponse {
  status: () => number;
  body: () => Promise<Buffer>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

interface CitedTracker {
  wikiPaths: string[];
  outputPaths: string[];
}

// runVisitorChatTurn —— drive one visitor question through backend
// /agent/turn endpoint. Returns a fake APIResponse mimicking legacy
// /messages surface: status() reflects /dialogs commit; body()/text()
// returns final assistant text.
export async function runVisitorChatTurn(
  request: APIRequestContext, sess: VisitorSession, question: string,
): Promise<FakeAPIResponse> {
  const system = await fetchSystemPrompt(sess);
  const headers = await buildHeaders(sess);
  const cited: CitedTracker = { wikiPaths: [], outputPaths: [] };
  const text = await runAgentTurn(
    request, sess, headers, system, question, cited,
  );
  return await commitDialog(request, sess, headers, question, text, cited);
}

async function runAgentTurn(
  request: APIRequestContext, sess: VisitorSession,
  headers: Record<string, string>, system: string, question: string,
  cited: CitedTracker,
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/v1/agent/turn`, {
    headers, data: {
      system, user_message: question,
      conversation_id: sess.conversation_id,
      history: [],
    },
  });
  if (res.status() !== 200) {
    throw new Error(`agent.turn: ${res.status()}`);
  }
  const body = await res.body();
  return accumulateAgentEvents(body.toString('utf-8'), cited);
}

interface AgentEventFrame {
  event: string;
  data: Record<string, unknown>;
}

function accumulateAgentEvents(raw: string, cited: CitedTracker): string {
  let text = '';
  for (const frame of splitFrames(raw)) {
    if (frame.event === 'text') {
      const delta = stringOr(frame.data['delta'], '');
      text += delta;
    } else if (frame.event === 'tool_completed') {
      trackToolCompleted(frame.data, cited);
    } else if (frame.event === 'error') {
      throw new Error(stringOr(frame.data['message'], 'agent error'));
    }
  }
  return text;
}

function trackToolCompleted(
  d: Record<string, unknown>, cited: CitedTracker,
): void {
  const name = stringOr(d['name'], '');
  if (name !== 'corpus_read') return;
  const rawResult = stringOr(d['result'], '');
  const inner = safeJson(rawResult) as { path?: string; genre?: string };
  if (!inner?.path || typeof inner.genre !== 'string') return;
  const stripped = stripGenrePrefix(inner.genre, inner.path);
  if (inner.genre === 'output') {
    cited.outputPaths.push(stripped);
  } else if (inner.genre === 'wiki') {
    cited.wikiPaths.push(stripped);
  }
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

function stripGenrePrefix(genre: string, path: string): string {
  const prefix = `${genre}/`;
  if (!path.startsWith(prefix)) return path;
  const tail = path.slice(prefix.length);
  if (isUUIDLike(tail)) return tail;
  return path;
}

function isUUIDLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function commitDialog(
  request: APIRequestContext, sess: VisitorSession,
  headers: Record<string, string>, question: string, answer: string,
  cited: CitedTracker,
): Promise<FakeAPIResponse> {
  const res = await request.post(
    `${BACKEND}/api/v1/sessions/${sess.conversation_id}/dialogs`,
    { headers, data: {
      question, answer,
      cited_wiki_paths: cited.wikiPaths,
      cited_output_paths: cited.outputPaths,
    } },
  );
  const status = res.status();
  if (status === 204 || status === 200) {
    return makeFakeResponse(200, answer);
  }
  const text = await res.text();
  return makeFakeResponse(status, text);
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
