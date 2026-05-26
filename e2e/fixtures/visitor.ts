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
  byoai_provider: string; // 'anthropic' / 'openai' / 'custom' / ...
  // byoai_key 不再上传给 server —— 浏览器自己保管，per-request 信封带过去。
  // node 端 fixture 直接持 plaintext，到 sendMessage 时跟 sessionToken 做 HKDF。
  byoai_key: string;
  byoai_endpoint: string; // base URL；不带 /v1/...
  byoai_model: string;    // model id
  visitor_name?: string;
}

// issueByoaiSession —— BYOAI tier。server 只看 byoai_provider；session 里
// 不缓存 key/endpoint/model。Fixture 把 plaintext 字段透传到 returned
// session 让 sendMessage 一并 wrap + 发 4 个 header。
export async function issueByoaiSession(
  request: APIRequestContext, input: IssueByoaiSessionInput,
): Promise<BYOAIVisitorSession> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    data: {
      tier: 'byoai',
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

export async function sendMessage(
  request: APIRequestContext, sess: VisitorSession, content: string,
): Promise<APIResponse> {
  return await request.post(`${BACKEND}/api/v1/sessions/${sess.conversation_id}/messages`, {
    headers: await buildMessageHeaders(sess),
    data: { content },
  });
}

async function buildMessageHeaders(
  sess: VisitorSession,
): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    Authorization: `Bearer ${sess.session_token}`,
    'Content-Type': 'application/json',
  };
  const byoai = sess as Partial<BYOAIVisitorSession>;
  if (!byoai.byoai_key || !byoai.byoai_provider) {
    return base;
  }
  const wrapped = await wrapBYOAIKey(byoai.byoai_key, sess.session_token);
  return {
    ...base,
    'X-BYOAI-Provider': byoai.byoai_provider,
    'X-BYOAI-Key': wrapped,
    'X-BYOAI-Endpoint': byoai.byoai_endpoint ?? '',
    'X-BYOAI-Model': byoai.byoai_model ?? '',
  };
}

// wrapBYOAIKey —— 跟 server cryptobox.{DeriveSessionKey,DecryptWithKey} 对
// 称的 Node-side 实现：HKDF-SHA256(ikm=session_token, info="standmeet-byoai-v1",
// salt=空, L=32) → AES-256-GCM seal(nonce(12)||ct||tag(16)) → base64 URL-safe
// no padding。跟 app 那侧 byoai-envelope.ts 同算法。
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
