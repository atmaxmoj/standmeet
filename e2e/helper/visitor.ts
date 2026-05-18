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
