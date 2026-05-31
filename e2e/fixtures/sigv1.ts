// sigv1.ts —— Phase C: Ed25519 sigv1 challenge signing for MCP auth.
//
// 同 youteacher 的 sig 形态：`standmeet-sigv1\n<keyId>\n<unix-ts>`，
// Authorization header `Sigv1 keyId=X,ts=N,sig=base64`。
//
// 每请求独立签 (没有 session cookie / 没有 token 缓存)。ts 5 min 窗口。

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

const CHALLENGE_NS = 'standmeet-sigv1';

export interface SignedChallenge {
  keyId: string;
  ts: number;
  sig: string; // base64
}

/** signChallenge —— 用 PEM 私钥签 challenge；返结构含 ts + sig，便于 caller
 *  自由组装 Authorization header (或测试时调成不一致 ts 验拒)。 */
export function signChallenge(privateKeyPem: string, keyId: string, ts: number): SignedChallenge {
  const challenge = Buffer.from(`${CHALLENGE_NS}\n${keyId}\n${ts}`, 'utf8');
  const key = createPrivateKey({ key: privateKeyPem, format: 'pem' });
  const sig = cryptoSign(null, challenge, key).toString('base64');
  return { keyId, ts, sig };
}

/** formatAuthHeader —— 把 signed challenge 序列化成 Authorization 头值。 */
export function formatAuthHeader(s: SignedChallenge): string {
  return `Sigv1 keyId=${s.keyId},ts=${s.ts},sig=${s.sig}`;
}

/** signNow —— 大多 spec 用：用当前 unix-ts 签一次。 */
export function signNow(privateKeyPem: string, keyId: string): SignedChallenge {
  return signChallenge(privateKeyPem, keyId, Math.floor(Date.now() / 1000));
}
