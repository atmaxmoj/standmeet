// visitor.ts —— public API (/api/v1/*) helper: issue a session, send messages.
//
// The /gate + /admin/codes UI has taken over the real user path. This simulates the
// visitor side for specs (after the gate UI landed, the visitor part of the access-codes
// spec switched to browser-driven).

import type { APIRequestContext, APIResponse } from '@playwright/test';

import {
  runVisitorChatTurn, type FakeAPIResponse,
} from '@/fixtures/visitor-chat-loop';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface SessionCapability {
  id: string;
  enabled: boolean;
  // title —— passes through the MCP tool's title (human-readable display name, used as the dock button label, no fallback).
  title?: string;
  quota_remaining?: number;
  policy_summary?: string;
}

// DockButton —— #109/#110 a dock button frozen in the session and renderable: capability id + display name (title) + trigger word.
// Capabilities denied by the code are already filtered out (they don't appear as buttons at all).
interface DockButton {
  capability_id: string;
  title: string;
  trigger: string;
}

export interface VisitorSession {
  session_token: string;
  conversation_id: string;
  member_id?: string;
  owner_handle: string;
  // D-2: used by pi-pivot —— the frontend zustand stores the capability map +
  // pi-agent-core fetches /api/v1/prompts/{id} by part_ids when assembling the system prompt.
  // Old specs don't touch these fields, so they're optional for compatibility.
  capabilities?: SessionCapability[];
  system_prompt_part_ids?: string[];
  // D-2 follow-up: role.PromptBody + skill prompts inline. When the frontend assembles the
  // system prompt it uses the order [visitor-header fragment, persona inline, ...cap
  // fragments]. Empty string = the role has no custom persona / no attached skill.
  system_prompt_persona?: string;
  // #109/#110: the ≤2 dock buttons the owner configured on the role (frozen, after filtering code-deny).
  dock_buttons?: DockButton[];
}

export interface IssueSessionInput {
  handle: string;
  mode?: 'code' | 'public';
  code?: string;
  visitor_name?: string;
  visitor_email?: string;
  member_id?: string;
}

export async function issueSession(
  request: APIRequestContext, input: IssueSessionInput,
): Promise<VisitorSession> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, { data: input });
  if (res.status() !== 200) throw new Error(`issue session failed: ${res.status()}`);
  return await res.json() as VisitorSession;
}

export interface IssueByoaiSessionInput {
  handle: string;
  byoai_provider: string; // 'anthropic' / 'openai' / 'custom' / ...
  // byoai_key is no longer uploaded to the server —— the browser keeps it and carries it in a per-request envelope.
  // The node-side fixture holds the plaintext directly, doing HKDF with the sessionToken at sendMessage time.
  byoai_key: string;
  byoai_endpoint: string; // base URL; without /v1/...
  byoai_model: string;    // model id
  visitor_name?: string;
}

// issueByoaiSession —— BYOAI mode. The server only sees byoai_provider; the session does not
// cache key/endpoint/model. The fixture passes the plaintext fields through to the returned
// session so sendMessage can wrap them + send the 4 headers.
export async function issueByoaiSession(
  request: APIRequestContext, input: IssueByoaiSessionInput,
): Promise<BYOAIVisitorSession> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    data: {
      mode: 'byoai',
      handle: input.handle,
      byoai_provider: input.byoai_provider,
      visitor_name: input.visitor_name,
    },
  });
  if (res.status() !== 200) throw new Error(`issue byoai session failed: ${res.status()}`);
  const sess = await res.json() as VisitorSession;
  return {
    ...sess,
    byoai_provider: input.byoai_provider, byoai_key: input.byoai_key,
    byoai_endpoint: input.byoai_endpoint, byoai_model: input.byoai_model,
  };
}

// BYOAIVisitorSession —— returned by issueByoaiSession; carries extra plaintext key + provider
// + endpoint + model so later sendMessage has its own wrap context.
export interface BYOAIVisitorSession extends VisitorSession {
  byoai_provider: string;
  byoai_key: string;
  byoai_endpoint: string;
  byoai_model: string;
}

// issueSessionStatus —— the "status only" version, for when a spec wants to see an error (403 / 410 etc.).
// Failure cases should not throw —— the caller asserts the status itself.
export async function issueSessionStatus(
  request: APIRequestContext, input: IssueSessionInput,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, { data: input });
  return res.status();
}

// sendMessage —— G-Y.6: the backend's POST /messages route was removed; spec fixtures
// instead run a loop equivalent to pi-agent-core on the Node side (visitor-chat-loop.ts),
// reducing "one visitor question" back to a fake APIResponse so existing spec asserts stay unchanged.
export async function sendMessage(
  request: APIRequestContext, sess: VisitorSession, content: string,
): Promise<APIResponse | FakeAPIResponse> {
  return await runVisitorChatTurn(request, sess, content);
}
