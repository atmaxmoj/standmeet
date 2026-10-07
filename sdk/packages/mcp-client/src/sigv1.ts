// sigv1.ts —— sign Ed25519 challenge for `Authorization: Sigv1 keyId=X,
// ts=N,nonce=UUID,v=2,sig=base64`. Each request is signed independently (no
// session cache); a 5 min ts window plus a one-time nonce guard against
// replay, and the signature is bound to the request it travels on (`v=2`):
// payload `standmeet-sigv1\n<keyId>\n<ts>\n<nonce>\n<METHOD>\n<path>\n<hex sha256(body)>`,
// matching backend internal/owner/usecase/keypairs.go + e2e/fixtures/sigv1.ts.
// A header lifted from one request is refused on any other.

import { createHash, createPrivateKey, randomUUID, sign as cryptoSign } from 'node:crypto';

import type { Creds } from './creds.js';

const CHALLENGE_NS = 'standmeet-sigv1';

/** The request a signature is made for: method, path (with query), body ('' for none). */
export interface SignedRequest {
  method: string;
  path: string;
  body: string;
}

export function signAuthHeader(creds: Creds, req: SignedRequest): string {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const bodyHash = createHash('sha256').update(req.body, 'utf8').digest('hex');
  const challenge = Buffer.from(
    `${CHALLENGE_NS}\n${creds.keyId}\n${ts}\n${nonce}\n${req.method.toUpperCase()}\n${req.path}\n${bodyHash}`,
    'utf8',
  );
  const key = createPrivateKey({ key: creds.privateKeyPem, format: 'pem' });
  const sig = cryptoSign(null, challenge, key).toString('base64');
  return `Sigv1 keyId=${creds.keyId},ts=${ts.toString()},nonce=${nonce},v=2,sig=${sig}`;
}
