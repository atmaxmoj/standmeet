// sigv1.ts —— Phase C: Ed25519 sigv1 challenge signing for MCP auth.
//
// Signing payload: `standmeet-sigv1\n<keyId>\n<unix-ts>\n<nonce>`,
// Authorization header `Sigv1 keyId=X,ts=N,nonce=UUID,sig=base64`.
//
// Signed per request (no session cookie / no token cache). ts within a 5 min window + a **single-use nonce**:
// the backend records seen nonces in Redis, and replaying the same header within the window → nonce already seen → reject (replay protection).
// The nonce makes each signature single-use: capturing one valid header still cannot be replayed.

import { createPrivateKey, randomUUID, sign as cryptoSign } from 'node:crypto';

const CHALLENGE_NS = 'standmeet-sigv1';

export interface SignedChallenge {
  keyId: string;
  ts: number;
  nonce: string;
  sig: string; // base64
}

/** signChallenge —— signs the challenge with a PEM private key; returns a struct with ts + nonce + sig,
 *  so the caller can freely assemble the Authorization header (or, in tests, tweak it to an inconsistent ts /
 *  reuse a nonce to verify rejection). nonce defaults to a random value; to simulate "capture and replay"
 *  a test reuses the same formatAuthHeader output. */
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

/** formatAuthHeader —— serializes a signed challenge into an Authorization header value. */
export function formatAuthHeader(s: SignedChallenge): string {
  return `Sigv1 keyId=${s.keyId},ts=${s.ts},nonce=${s.nonce},sig=${s.sig}`;
}

/** signNow —— used by most specs: sign once with the current unix-ts + a fresh random nonce. */
export function signNow(privateKeyPem: string, keyId: string): SignedChallenge {
  return signChallenge(privateKeyPem, keyId, Math.floor(Date.now() / 1000));
}
