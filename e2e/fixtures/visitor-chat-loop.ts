// visitor-chat-loop.ts —— Node-side agent loop driving /inference/stream
// + per-tool dispatch + /dialogs commit, mimicking the old POST
// /messages behavior so existing specs keep their sendMessage() shape.
//
// pi-agent-core in the browser does the same work for real visitors;
// this fixture replays it inside Node so e2e fixtures can drain a
// "turn" with one call and assert on a fake APIResponse.
//
// Wire format outgoing (to /inference/stream): Anthropic-shape
//   messages: [{role, content: [content_block...]}]
// Incoming SSE: Anthropic native (message_start / content_block_delta /
// message_stop). We parse just text deltas + tool_use blocks.

import type { APIRequestContext } from '@playwright/test';

import type { VisitorSession, BYOAIVisitorSession } from '@/fixtures/visitor';

export interface FakeAPIResponse {
  status: () => number;
  body: () => Promise<Buffer>;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const MAX_ITERATIONS = 8;

interface VisitorToolSpec {
  name: string;
  description: string;
  input_schema: unknown;
}

interface PiMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

// runVisitorChatTurn —— drive one visitor question through the pi-agent
// loop. Returns a fake APIResponse that mimics what POST /messages used
// to return: status() reflects the /dialogs commit status (200/204 → 200,
// quota 403 → 403, etc.), body()/text() returns the final assistant text.
export async function runVisitorChatTurn(
  request: APIRequestContext, sess: VisitorSession, question: string,
): Promise<FakeAPIResponse> {
  const tools = fetchSessionToolSpecs(sess);
  const system = await fetchSystemPrompt(sess);
  const headers = await buildHeaders(sess);
  const history: PiMessage[] = [
    { role: 'user', content: [{ type: 'text', text: question }] },
  ];
  const ctx: TurnCtx = {
    headers, sess, tools, system, request,
    cited: { wikiPaths: [], outputPaths: [] },
  };
  const finalText = await driveAgentLoop(history, ctx);
  return await commitDialog(ctx, question, finalText);
}

interface TurnCtx {
  request: APIRequestContext;
  sess: VisitorSession;
  tools: VisitorToolSpec[];
  system: string;
  headers: Record<string, string>;
  cited: CitedTracker;
}

// CitedTracker —— walks corpus_read tool dispatches and stashes the
// path + the inferred kind (wiki/output) so /dialogs commit knows what
// to attribute. The kind comes from the tool result envelope; if not
// present, default to wiki (best-effort).
interface CitedTracker {
  wikiPaths: string[];
  outputPaths: string[];
}

async function driveAgentLoop(
  history: PiMessage[], ctx: TurnCtx,
): Promise<string> {
  let finalText = '';
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const step = await runStreamStep(history, ctx);
    finalText = step.text;
    if (step.toolCalls.length === 0) return finalText;
    history.push(buildAssistantTurnMsg(step));
    for (const call of step.toolCalls) {
      const result = await dispatchTool(ctx, call);
      history.push(buildToolResultMsg(call.id, result));
    }
  }
  return finalText;
}

interface StreamStep {
  text: string;
  toolCalls: { id: string; name: string; input: unknown }[];
}

async function runStreamStep(
  history: PiMessage[], ctx: TurnCtx,
): Promise<StreamStep> {
  const res = await ctx.request.post(`${BACKEND}/api/v1/inference/stream`, {
    headers: ctx.headers,
    data: {
      system: ctx.system,
      messages: history,
      tools: ctx.tools,
    },
  });
  if (res.status() !== 200) {
    throw new Error(`inference.stream: ${res.status()}`);
  }
  const body = await res.body();
  return parseAnthropicSSE(body.toString('utf-8'));
}

function parseAnthropicSSE(raw: string): StreamStep {
  const blocks = new Map<number, BlockState>();
  for (const frame of splitFrames(raw)) {
    applyFrame(frame, blocks);
  }
  return finalizeBlocks(blocks);
}

interface BlockState {
  kind: 'text' | 'tool_use';
  id: string;
  name: string;
  text: string;
  inputBuf: string;
}

function splitFrames(raw: string): { event: string; data: string }[] {
  const out: { event: string; data: string }[] = [];
  for (const chunk of raw.split('\n\n')) {
    const frame = parseFrame(chunk);
    if (frame !== null) out.push(frame);
  }
  return out;
}

function parseFrame(raw: string): { event: string; data: string } | null {
  let ev = ''; let dt = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event: ')) ev = line.slice(7).trim();
    else if (line.startsWith('data: ')) dt = line.slice(6).trim();
  }
  return ev === '' ? null : { event: ev, data: dt };
}

function applyFrame(
  frame: { event: string; data: string }, blocks: Map<number, BlockState>,
): void {
  const d = safeJson(frame.data) as Record<string, unknown>;
  switch (frame.event) {
    case 'content_block_start':
      handleBlockStart(d, blocks);
      return;
    case 'content_block_delta':
      handleBlockDelta(d, blocks);
      return;
    case 'error':
      throw new Error(typeof d['message'] === 'string' ? d['message'] : 'sse error');
    default:
      // message_start / content_block_stop / message_delta / message_stop —
      // no state change for our needs.
  }
}

function handleBlockStart(
  d: Record<string, unknown>, blocks: Map<number, BlockState>,
): void {
  const idx = d['index'] as number | undefined;
  const cb = d['content_block'] as Record<string, unknown> | undefined;
  if (idx === undefined || !cb) return;
  blocks.set(idx, {
    kind: (cb['type'] === 'tool_use' ? 'tool_use' : 'text'),
    id: (cb['id'] as string | undefined) ?? '',
    name: (cb['name'] as string | undefined) ?? '',
    text: '',
    inputBuf: '',
  });
}

function handleBlockDelta(
  d: Record<string, unknown>, blocks: Map<number, BlockState>,
): void {
  const idx = d['index'] as number | undefined;
  const delta = d['delta'] as Record<string, unknown> | undefined;
  if (idx === undefined || !delta) return;
  const b = blocks.get(idx);
  if (!b) return;
  if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
    b.text += delta['text'];
  }
  if (delta['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
    b.inputBuf += delta['partial_json'];
  }
}

function finalizeBlocks(blocks: Map<number, BlockState>): StreamStep {
  const sorted = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  let text = '';
  const toolCalls: { id: string; name: string; input: unknown }[] = [];
  for (const b of sorted) {
    if (b.kind === 'text') text += b.text;
    else toolCalls.push({
      id: b.id, name: b.name,
      input: b.inputBuf === '' ? {} : safeJson(b.inputBuf),
    });
  }
  return { text, toolCalls };
}

function buildAssistantTurnMsg(step: StreamStep): PiMessage {
  const blocks: ContentBlock[] = [];
  if (step.text !== '') blocks.push({ type: 'text', text: step.text });
  for (const c of step.toolCalls) {
    blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
  }
  return { role: 'assistant', content: blocks };
}

function buildToolResultMsg(toolUseID: string, result: ToolResultBody): PiMessage {
  return {
    role: 'user',
    content: [{
      type: 'tool_result', tool_use_id: toolUseID,
      content: JSON.stringify({ ok: result.ok, result: result.result, reason: result.reason }),
    }],
  };
}

interface ToolResultBody {
  ok: boolean;
  result?: unknown;
  reason?: string;
}

async function dispatchTool(
  ctx: TurnCtx, call: { id: string; name: string; input: unknown },
): Promise<ToolResultBody> {
  const res = await ctx.request.post(
    `${BACKEND}/api/v1/sessions/${ctx.sess.conversation_id}/tools/${call.name}`,
    { headers: ctx.headers, data: call.input },
  );
  if (res.status() !== 200) {
    return { ok: false, reason: `tool ${call.name} returned ${res.status()}` };
  }
  const result = await res.json() as ToolResultBody;
  trackCited(ctx, call, result);
  return result;
}

// trackCited —— corpus_read returns { result: { genre, body, path, title } };
// stash path into the right bucket so /dialogs commit attributes it as
// cited wiki vs output.
function trackCited(
  ctx: TurnCtx,
  call: { name: string; input: unknown },
  result: ToolResultBody,
): void {
  if (call.name !== 'corpus_read' || !result.ok) return;
  const inner = result.result as { path?: string; genre?: string } | undefined;
  if (!inner?.path) return;
  // Strip the "wiki/" / "output/" prefix when the underlying entry has
  // no real path (the retriever synthesizes "<genre>/<uuid>" in that
  // case). RecordDialog's Corpus.Get accepts UUID or path; UUID wins.
  const cited = stripGenrePrefix(inner.genre ?? '', inner.path);
  if (inner.genre === 'output') {
    ctx.cited.outputPaths.push(cited);
  } else if (inner.genre === 'wiki') {
    ctx.cited.wikiPaths.push(cited);
  }
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
  ctx: TurnCtx, question: string, answer: string,
): Promise<FakeAPIResponse> {
  const res = await ctx.request.post(
    `${BACKEND}/api/v1/sessions/${ctx.sess.conversation_id}/dialogs`,
    { headers: ctx.headers, data: {
      question, answer,
      cited_wiki_paths: ctx.cited.wikiPaths,
      cited_output_paths: ctx.cited.outputPaths,
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

function fetchSessionToolSpecs(sess: VisitorSession): VisitorToolSpec[] {
  // Specs come from session response cached on first call. We don't
  // re-fetch — sess.tool_specs is populated by issueSession/code.
  // Fall back to empty list if visitor session didn't include them.
  const anySess = sess as unknown as { tool_specs?: VisitorToolSpec[] };
  return anySess.tool_specs ?? [];
}

async function fetchSystemPrompt(sess: VisitorSession): Promise<string> {
  // Compose: each part_id fetched + persona inline.
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

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
