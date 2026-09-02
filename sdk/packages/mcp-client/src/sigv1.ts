// sigv1.ts —— sign Ed25519 challenge for `Authorization: Sigv1 keyId=X,
// ts=N,nonce=UUID,sig=base64`. Each request is signed independently (no
// session cache); a 5 min ts window plus a one-time nonce guard against
// replay. Payload is `standmeet-sigv1\n<keyId>\n<ts>\n<nonce>`, matching
// backend internal/usecases/keypairs.go + e2e/fixtures/sigv1.ts.

import { createPrivateKey, randomUUID, sign as cryptoSign } from 'node:crypto';

import type { Creds } from './creds.js';

const CHALLENGE_NS = 'standmeet-sigv1';

export function signAuthHeader(creds: Creds): string {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const challenge = Buffer.from(
    `${CHALLENGE_NS}\n${creds.keyId}\n${ts}\n${nonce}`,
    'utf8',
  );
  const key = createPrivateKey({ key: creds.privateKeyPem, format: 'pem' });
  const sig = cryptoSign(null, challenge, key).toString('base64');
  return `Sigv1 keyId=${creds.keyId},ts=${ts.toString()},nonce=${nonce},sig=${sig}`;
}
