// visitor.ts —— public API (/api/v1/*) helper：颁发 session、发消息。
//
// /gate + /admin/codes UI 已经接管真用户路径。这里给 spec 仿真
// visitor 侧（gate UI 落地之后 access-codes spec 的 visitor 部分
// 改成浏览器驱动）。

import type { APIRequestContext, APIResponse } from '@playwright/test';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

export interface VisitorSession {
  session_token: string;
  conversation_id: string;
  owner_handle: string;
  included_tags: string[];
  excluded_tags: string[];
}

export interface IssueSessionInput {
  handle: string;
  tier?: 'code' | 'public';
  code?: string;
  visitor_name?: string;
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
  byoai_provider: 'anthropic';
  byoai_key: string;
  visitor_name?: string;
}

// issueByoaiSession —— BYOAI tier：visitor 自带 key。retrieval-redesign 后
// backend 在 Redis session 里加密存 key，per-request 解密给 inference。
// BYOAI session 默认 corpus_permissions = allow `public/**` deny `**`，
// owner 设定，访客无法覆写。
export async function issueByoaiSession(
  request: APIRequestContext, input: IssueByoaiSessionInput,
): Promise<VisitorSession> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    data: { ...input, tier: 'byoai' },
  });
  if (res.status() !== 200) throw new Error(`issue byoai session failed: ${res.status()}`);
  return await res.json() as VisitorSession;
}

// issueSessionStatus —— spec 想看错误（403 / 410 等）时用的"只问 status"版本。
// 失败用例不该 throw —— caller 自己 assert status。
export async function issueSessionStatus(
  request: APIRequestContext, input: IssueSessionInput,
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, { data: input });
  return res.status();
}

export async function sendMessage(
  request: APIRequestContext, sess: VisitorSession, content: string,
): Promise<APIResponse> {
  return await request.post(`${BACKEND}/api/v1/sessions/${sess.conversation_id}/messages`, {
    headers: {
      Authorization: `Bearer ${sess.session_token}`,
      'Content-Type': 'application/json',
    },
    data: { content },
  });
}
