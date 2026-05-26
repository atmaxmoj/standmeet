// byoai-envelope.ts —— 给 chat 请求用：把 BYOAI 明文 api key 封进 wire-format
// envelope，server 端 unwrapBYOAIKey 用同样 HKDF info + session_token 派生
// AES-256 key 解封（见 backend/internal/routes/public/byoai_envelope.go）。
//
// Wire format:
//   1. HKDF-SHA256(ikm=session_token UTF-8, salt=∅, info="standmeet-byoai-v1", L=32)
//      → AES-256 key
//   2. AES-256-GCM Seal: nonce(12) || ct || tag(16)
//   3. base64 URL-safe（no padding）
//
// 仅 BYOAI tier 用；其他 tier 完全不 send 这俩 header。Web Crypto subtle 原生
// 跑，无第三方依赖。

const HKDF_INFO = 'standmeet-byoai-v1';
const NONCE_LEN = 12;

// wrapBYOAIKey —— 输入明文 api key + session_token，输出 base64 URL-safe (no
// padding) envelope 字符串，直接塞 `X-BYOAI-Key` header。
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
