// visitor.ts —— public API (/api/v1/*) helper：颁发 session、发消息。
//
// /gate + /admin/codes UI 已经接管真用户路径。这里给 spec 仿真
// visitor 侧（gate UI 落地之后 access-codes spec 的 visitor 部分
// 改成浏览器驱动）。

import type { APIRequestContext, APIResponse } from '@playwright/test';

import {
  runVisitorChatTurn, type FakeAPIResponse,
} from '@/fixtures/visitor-chat-loop';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface SessionCapability {
  id: string;
  enabled: boolean;
  quota_remaining?: number;
  policy_summary?: string;
}

export interface VisitorSession {
  session_token: string;
  conversation_id: string;
  member_id?: string;
  owner_handle: string;
  // D-2: pi-pivot 用 —— 前端 zustand 存 capability map +
  // pi-agent-core 装 system prompt 时按 part_ids 拉 /api/v1/prompts/{id}。
  // 旧 spec 不 touch 这些字段，optional 兼容。
  capabilities?: SessionCapability[];
  system_prompt_part_ids?: string[];
  // D-2 follow-up: role.PromptBody + skill prompts inline。frontend 拼
  // system prompt 时用 [visitor-header fragment, persona inline, ...cap
  // fragments] 顺序。空字符串 = role 没自定义 persona / 没挂 skill。
  system_prompt_persona?: string;
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
  // byoai_key 不再上传给 server —— 浏览器自己保管，per-request 信封带过去。
  // node 端 fixture 直接持 plaintext，到 sendMessage 时跟 sessionToken 做 HKDF。
  byoai_key: string;
  byoai_endpoint: string; // base URL；不带 /v1/...
  byoai_model: string;    // model id
  visitor_name?: string;
}

// issueByoaiSession —— BYOAI mode。server 只看 byoai_provider；session 里
// 不缓存 key/endpoint/model。Fixture 把 plaintext 字段透传到 returned
// session 让 sendMessage 一并 wrap + 发 4 个 header。
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

// BYOAIVisitorSession —— issueByoaiSession 返回；多带 plaintext key + provider
// + endpoint + model 让后续 sendMessage 自带 wrap 上下文。
export interface BYOAIVisitorSession extends VisitorSession {
  byoai_provider: string;
  byoai_key: string;
  byoai_endpoint: string;
  byoai_model: string;
}

// issueSessionStatus —— spec 想看错误（403 / 410 等）时用的"只问 status"版本。
// 失败用例不该 throw —— caller 自己 assert status。
export async function issueSessionStatus(
  request: APIRequestContext, input: IssueSessionInput,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, { data: input });
  return res.status();
}

// sendMessage —— G-Y.6: backend 的 POST /messages 路由删了；spec fixtures
// 转而在 Node 侧跑跟 pi-agent-core 等价的 loop (visitor-chat-loop.ts)，
// 把"一次访客提问"还原成 fake APIResponse 让现有 spec assert 不变。
export async function sendMessage(
  request: APIRequestContext, sess: VisitorSession, content: string,
): Promise<APIResponse | FakeAPIResponse> {
  return await runVisitorChatTurn(request, sess, content);
}
