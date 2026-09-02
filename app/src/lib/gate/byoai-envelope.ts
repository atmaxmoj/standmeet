// byoai-envelope.ts —— used for chat requests: wraps the BYOAI plaintext api
// key into a wire-format envelope; the server's unwrapBYOAIKey derives the
// same AES-256 key from the same HKDF info + session_token to unwrap it
// (see backend/internal/routes/public/byoai_envelope.go).
//
// Wire format:
//   1. HKDF-SHA256(ikm=session_token UTF-8, salt=∅, info="standmeet-byoai-v1", L=32)
//      → AES-256 key
//   2. AES-256-GCM Seal: nonce(12) || ct || tag(16)
//   3. base64 URL-safe（no padding）
//
// Used only in BYOAI mode; other modes send neither header at all. Runs
// natively on Web Crypto subtle, no third-party dependency.

const HKDF_INFO = 'standmeet-byoai-v1';
const NONCE_LEN = 12;

// wrapBYOAIKey —— takes a plaintext api key + session_token, outputs a
// base64 URL-safe (no padding) envelope string, ready to drop straight into
// the `X-BYOAI-Key` header.
export async function wrapBYOAIKey(
  plainKey: string, sessionToken: string,
): Promise<string> {
  const enc = new TextEncoder();
  const aes = await deriveAESKey(sessionToken);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aes, enc.encode(plainKey),
  );
  return b64encodeURL(concat(nonce, new Uint8Array(sealed)));
}

async function deriveAESKey(sessionToken: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey(
    'raw', enc.encode(sessionToken), 'HKDF', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF', hash: 'SHA-256',
      salt: new Uint8Array(0), info: enc.encode(HKDF_INFO),
    },
    ikm, 256,
  );
  return await crypto.subtle.importKey(
    'raw', bits, { name: 'AES-GCM' }, false, ['encrypt'],
  );
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function b64encodeURL(bytes: Uint8Array): string {
  let s = '';
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
