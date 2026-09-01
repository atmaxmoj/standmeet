// embed-token.ts —— sign a per-embed EdDSA JWT the way the <standmeet-chat> widget will.
//
// The embed's JS holds a per-embed Ed25519 private key (NOT the access code). Each session
// issue signs a short-lived JWT that folds in the four anti-forgery elements — bound origin,
// expiry, and a one-time jti (Turnstile is a conditional server-side layer, off by default in
// dev). The server verifies with the embed's stored public key, resolves it to the code_id,
// and issues the session — the plaintext code never leaves the server.
//
// Design: wiki/.../key-designs/embed-credential-never-carries-the-code.
//
// This fixture is the Node analog of embed.ts's signer, the way sigv1.ts is for owner MCP auth.

import { createPrivateKey, randomUUID, sign as cryptoSign } from 'node:crypto';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface EmbedTokenOpts {
  keyId: string;            // JWT `kid` header — selects the embed's public key
  embedId: string;          // JWT `iss` claim — the embed
  origin: string;           // `origin` claim — the host origin, bound into the signature
  privateKeyPem: string;    // the per-embed Ed25519 private key (PKCS8 PEM)
  // overrides for negative tests:
  iat?: number;
  exp?: number;
  jti?: string;
  alg?: string;             // tamper the header alg (e.g. "none") to prove alg-pinning
}

// signEmbedToken —— produce `header.payload.signature` (EdDSA over the signing input).
export function signEmbedToken(o: EmbedTokenOpts): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: o.alg ?? 'EdDSA', typ: 'JWT', kid: o.keyId };
  const payload = {
    iss: o.embedId,
    iat: o.iat ?? now,
    exp: o.exp ?? now + 300,
    jti: o.jti ?? randomUUID(),
    origin: o.origin,
  };
  const signingInput =
    `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const key = createPrivateKey({ key: o.privateKeyPem, format: 'pem' });
  const sig = b64url(cryptoSign(null, Buffer.from(signingInput), key));
  return `${signingInput}.${sig}`;
}
