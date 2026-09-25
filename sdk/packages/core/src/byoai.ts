// byoai.ts —— the visitor's own AI key ("bring your own key"), browser-only. One implementation,
// used by both the app's /gate panel and the embedded AgentWidget (moved here from the app, where
// the widget couldn't reach it). The app and a microsite share an origin, so a key saved on /gate is
// the same key the widget finds, and vice versa.
//
// Storage (XSS-resistant):
//   - A non-extractable AES-256-GCM CryptoKey lives in IndexedDB (db "standmeet-byoai", store
//     "wrap", key "v1"). JS can only encrypt/decrypt with it, never export its bytes.
//   - The api key is AES-GCM encrypted with it; {iv, ct} plus the non-secret provider / endpoint /
//     model sit in localStorage `standmeet:byoai:v2`. Either store alone is useless.
//
// On the wire (per turn): wrapBYOAIKey seals the key under HKDF-SHA256(session_token,
// info "standmeet-byoai-v1") with AES-256-GCM → base64url(nonce || ct || tag), the `X-BYOAI-Key`
// header. The backend (routes/public/byoai_envelope.go) derives the same key to unwrap it.
//
// Needs crypto.subtle, which exists only in a secure context (https or localhost):
// keyStorageAvailable() says whether this page can hold a key at all (F-D-14).

const LS_KEY = 'standmeet:byoai:v2';
const LS_KEY_LEGACY_V1 = 'standmeet:byoai:v1';
const IDB_NAME = 'standmeet-byoai';
const IDB_STORE = 'wrap';
const IDB_KEY = 'v1';
const IV_LEN = 12;
const HKDF_INFO = 'standmeet-byoai-v1';

// BYOAIVaultMeta —— the non-secret part of the saved cred (UI and headers read it sync).
export interface BYOAIVaultMeta {
  provider: string;
  endpoint: string;
  model: string;
}

export interface BYOAICredFull extends BYOAIVaultMeta {
  key: string;
}

interface StoredEnvelope extends BYOAIVaultMeta {
  iv: string;
  ct: string;
}

// keyStorageAvailable —— can this realm do the Web Crypto wrapping. true under SSR (no window):
// the client corrects it after mount, so an https visitor doesn't see a warning flash.
export function keyStorageAvailable(): boolean {
  if (typeof window === 'undefined') return true;
  return typeof window.crypto !== 'undefined' && window.crypto.subtle !== undefined;
}

// storeBYOAI —— first write / overwrite. Creates the wrap key on first use.
export async function storeBYOAI(input: BYOAICredFull): Promise<void> {
  const wrap = await loadOrCreateWrapKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, wrap, new TextEncoder().encode(input.key),
  );
  const env: StoredEnvelope = {
    provider: input.provider, endpoint: input.endpoint, model: input.model,
    iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)),
  };
  window.localStorage.setItem(LS_KEY, JSON.stringify(env));
}

// forgetBYOAI —— the visitor drops their saved key (the wrap key stays; it encrypts nothing now).
export function forgetBYOAI(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(LS_KEY);
}

// readBYOAIVaultMeta —— sync provider/endpoint/model; never the key.
export function readBYOAIVaultMeta(): BYOAIVaultMeta | null {
  const env = readEnvelope();
  return env ? { provider: env.provider, endpoint: env.endpoint, model: env.model } : null;
}

// readBYOAICredFull —— everything the per-turn headers need, key decrypted. null if missing.
export async function readBYOAICredFull(): Promise<BYOAICredFull | null> {
  const env = readEnvelope();
  if (!env) return null;
  const key = await decryptEnvelope(env);
  if (key === null) return null;
  return { provider: env.provider, endpoint: env.endpoint, model: env.model, key };
}

// wrapBYOAIKey —— the plaintext key sealed for one session, ready for `X-BYOAI-Key`.
export async function wrapBYOAIKey(plainKey: string, sessionToken: string): Promise<string> {
  const enc = new TextEncoder();
  const ikm = await crypto.subtle.importKey('raw', enc.encode(sessionToken), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(HKDF_INFO) },
    ikm, 256,
  );
  const aes = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, enc.encode(plainKey));
  const out = new Uint8Array(nonce.length + sealed.byteLength);
  out.set(nonce, 0);
  out.set(new Uint8Array(sealed), nonce.length);
  return b64encode(out);
}

function readEnvelope(): StoredEnvelope | null {
  if (typeof window === 'undefined') return null;
  // v1 lacked endpoint/model and had no prod users: cleared, not migrated.
  if (window.localStorage.getItem(LS_KEY_LEGACY_V1) !== null) {
    window.localStorage.removeItem(LS_KEY_LEGACY_V1);
  }
  const raw = window.localStorage.getItem(LS_KEY);
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isEnvelope(v) ? v : null;
  } catch {
    return null;
  }
}

function isEnvelope(v: unknown): v is StoredEnvelope {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r['provider'] === 'string' && r['provider'] !== ''
    && typeof r['endpoint'] === 'string' && typeof r['model'] === 'string'
    && typeof r['iv'] === 'string' && typeof r['ct'] === 'string';
}

async function decryptEnvelope(env: StoredEnvelope): Promise<string | null> {
  const wrap = await loadWrapKey();
  if (!wrap) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(env.iv) }, wrap, b64decode(env.ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

async function loadOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await loadWrapKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idb('readwrite', (store) => store.put(key, IDB_KEY));
  return key;
}

async function loadWrapKey(): Promise<CryptoKey | null> {
  const v = await idb<unknown>('readonly', (store) => store.get(IDB_KEY));
  return v instanceof CryptoKey ? v : null;
}

// idb —— one transaction on the wrap store, as a promise.
async function idb<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('idb tx failed'));
    });
  } finally {
    db.close();
  }
}

// base64 url-safe, no padding.
function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// b64decode —— Uint8Array<ArrayBuffer> explicitly: Web Crypto's BufferSource rejects the
// SharedArrayBuffer-backed default.
function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
