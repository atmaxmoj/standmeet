// sigv1.ts —— Phase C: Ed25519 sigv1 challenge signing for MCP auth.
//
// 签名载荷：`standmeet-sigv1\n<keyId>\n<unix-ts>\n<nonce>`，
// Authorization header `Sigv1 keyId=X,ts=N,nonce=UUID,sig=base64`。
//
// 每请求独立签 (没有 session cookie / 没有 token 缓存)。ts 5 min 窗口 + **一次性 nonce**：
// 后端把见过的 nonce 记 Redis，窗口内重放同一个头 → nonce 已见 → 拒（防重放）。
// nonce 让每个签名一次性：捕获一个合法头也无法重放。

import { createPrivateKey, randomUUID, sign as cryptoSign } from 'node:crypto';

const CHALLENGE_NS = 'standmeet-sigv1';

export interface SignedChallenge {
  keyId: string;
  ts: number;
  nonce: string;
  sig: string; // base64
}

/** signChallenge —— 用 PEM 私钥签 challenge；返结构含 ts + nonce + sig，便于 caller
 *  自由组装 Authorization header (或测试时调成不一致 ts / 复用 nonce 验拒)。
 *  nonce 缺省随机生成；测试要模拟"捕获重放"就复用同一个 formatAuthHeader 输出。 */
export function signChallenge(
  privateKeyPem: string,
  keyId: string,
  ts: number,
  nonce: string = randomUUID(),
): SignedChallenge {
  const challenge = Buffer.from(`${CHALLENGE_NS}\n${keyId}\n${ts}\n${nonce}`, 'utf8');
  const key = createPrivateKey({ key: privateKeyPem, format: 'pem' });
  const sig = cryptoSign(null, challenge, key).toString('base64');
  return { keyId, ts, nonce, sig };
}

/** formatAuthHeader —— 把 signed challenge 序列化成 Authorization 头值。 */
export function formatAuthHeader(s: SignedChallenge): string {
  return `Sigv1 keyId=${s.keyId},ts=${s.ts},nonce=${s.nonce},sig=${s.sig}`;
}

/** signNow —— 大多 spec 用：用当前 unix-ts + 新随机 nonce 签一次。 */
export function signNow(privateKeyPem: string, keyId: string): SignedChallenge {
  return signChallenge(privateKeyPem, keyId, Math.floor(Date.now() / 1000));
}
