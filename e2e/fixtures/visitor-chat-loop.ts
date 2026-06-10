// visitor-chat-loop.ts —— H.10: backend agent loop 接管之后，Node 端
// fixture 不再 driver LLM ↔ tool 循环；改成单 POST /api/v1/agent/turn
// 收 SSE 整套事件 (text / tool_started / tool_completed / done / error)
// → 累 final text。
//
// 跟浏览器 pi-agent-core (H.10 后 VisitorTurnAgent) 同形态：thin event
// consumer。#28 起 backend 自己在 /agent/turn 流末端把这轮(含 cited /
// tool_calls)sink 进 conversation 表,fixture 不再 POST /dialogs —— 跟真
// 前端一致;失败/配额错误原样透 status 让 spec 断言。

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
// /agent/turn endpoint. #28 起 /agent/turn 自己把这轮 sink 进 conversation
// 表(配额也在它入口查),fixture 不再 POST /dialogs —— 跟真前端一致。返回
// fake APIResponse 仿 legacy /messages surface:成功 status()=200、text()=
// final assistant text;pre-stream 错误(配额 403 / 鉴权)原样透 status + body
// 让 spec 断言(turn-quota 第 3 轮 403 turn_quota_reached 走这条)。
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

// accumulateAgentEvents —— SSE 帧 → final assistant text。error 帧 throw
// (mock 注入故障 / force-final 也失败时走这条),让失败 turn 的 spec 能断言。
// citation / tool_calls 不在这累:#28 起 backend 自己从流末端扒并落库。
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
