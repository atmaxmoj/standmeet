import { z } from 'zod';

// byoai-vault.ts —— browser-only encrypted store for the visitor's BYOAI cred.
//
// XSS-resistant design:
//   - A non-extractable AES-256-GCM CryptoKey lives in IndexedDB (db:
//     "standmeet-byoai", store: "wrap", key: "v1"). A CryptoKey object never
//     exposes its raw bytes to JS — even if XSS gets an indexedDB handle, it
//     can only call encrypt/decrypt, never export the key to send to an
//     attacker's server.
//   - The BYOAI api key plaintext is first AES-GCM encrypted with that
//     CryptoKey into {iv, ct}, serialized to JSON, and stored as one blob
//     under localStorage key `standmeet:byoai:v2` (meta: provider / endpoint
//     / model sit alongside the ciphertext so chat can grab everything in
//     one read over SSE). localStorage alone is useless if dumped (missing
//     the CryptoKey); IndexedDB alone is useless if read (missing the
//     ciphertext).
//
// v1 → v2 upgrade: v1 only stored {provider, iv, ct}; supporting multiple
// providers plus endpoint/model required renegotiating the shape. v1 had no
// prod users, so it's simply cleared, no migration.
//
// Usage:
//   await storeBYOAI({provider, endpoint, model, key});  // into the vault
//   readBYOAIVaultMeta() === {provider, endpoint, model} // sync UI metadata
//   await readBYOAICredFull() === {...meta, key}          // chat grabs it all at once
//
// Modern browsers only; no fallback for missing crypto.subtle.

const LS_KEY = 'standmeet:byoai:v2';
const LS_KEY_LEGACY_V1 = 'standmeet:byoai:v1';
const IDB_NAME = 'standmeet-byoai';
const IDB_STORE = 'wrap';
const IDB_KEY = 'v1';
const IV_LEN = 12;

// BYOAIVaultMeta —— the non-secret part of the vault: UI rendering and the
// chat header both need it, and neither needs to await decrypt. endpoint /
// model are written / cleared together with provider.
export interface BYOAIVaultMeta {
  provider: string;
  endpoint: string;
  model: string;
}

export interface BYOAICredFull extends BYOAIVaultMeta {
  key: string;
}

interface StoredEnvelope extends BYOAIVaultMeta {
  iv: string; // base64 (no padding, URL-safe)
  ct: string; // base64 (no padding, URL-safe)
}

// storeBYOAI —— first write / overwrite into the vault. If IndexedDB
// doesn't have a wrap key yet, generate a non-extractable one on the spot
// and store it; then use it to encrypt the plaintext.
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

// readBYOAIVaultMeta —— sync; used by UI / chat header to read
// provider+endpoint+model. The plaintext key is never returned here.
export function readBYOAIVaultMeta(): BYOAIVaultMeta | null {
  const env = readEnvelope();
  return env ? { provider: env.provider, endpoint: env.endpoint, model: env.model } : null;
}

// readBYOAICredFull —— async; before chat sends a request it grabs all 4
// header fields at once (provider + endpoint + model + plaintext key). If
// any is missing, returns null and the caller falls back to the "BYOAI not
// configured" path.
export async function readBYOAICredFull(): Promise<BYOAICredFull | null> {
  const env = readEnvelope();
  if (!env) return null;
  const key = await decryptEnvelope(env);
  if (key === null) return null;
  return {
    provider: env.provider, endpoint: env.endpoint, model: env.model, key,
  };
}

function readEnvelope(): StoredEnvelope | null {
  if (typeof window === 'undefined') return null;
  // Clear any leftover legacy v1 while we're here (no migration — v1 is
  // missing the endpoint/model fields).
  if (window.localStorage.getItem(LS_KEY_LEGACY_V1) !== null) {
    window.localStorage.removeItem(LS_KEY_LEGACY_V1);
  }
  const raw = window.localStorage.getItem(LS_KEY);
  return raw ? parseEnvelope(raw) : null;
}

function parseEnvelope(raw: string): StoredEnvelope | null {
  try {
    const v: unknown = JSON.parse(raw);
    return isEnvelope(v) ? v : null;
  } catch {
    return null;
  }
}

const StoredEnvelopeSchema = z.object({
  provider: z.string().min(1), endpoint: z.string(), model: z.string(),
  iv: z.string(), ct: z.string(),
});

function isEnvelope(v: unknown): v is StoredEnvelope {
  return StoredEnvelopeSchema.safeParse(v).success;
}

async function decryptEnvelope(env: StoredEnvelope): Promise<string | null> {
  const wrap = await loadWrapKey();
  if (!wrap) return null;
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64decode(env.iv) }, wrap, b64decode(env.ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

async function loadOrCreateWrapKey(): Promise<CryptoKey> {
  const existing = await loadWrapKey();
  return existing ?? await createWrapKey();
}

async function createWrapKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  await idbPut(key);
  return key;
}

async function loadWrapKey(): Promise<CryptoKey | null> {
  const v = await idbGet();
  return v instanceof CryptoKey ? v : null;
}

// ─── IndexedDB helpers ──────────────────────────────────────────────────
// A Promise wrapper turns IDBRequest's onsuccess/onerror into awaitable calls.

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.objectStoreNames.contains(IDB_STORE)
        || req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
  });
}

async function idbPut(key: CryptoKey): Promise<void> {
  const db = await openDB();
  await runTx(db, 'readwrite', (store) => store.put(key, IDB_KEY));
  db.close();
}

async function idbGet(): Promise<unknown> {
  const db = await openDB();
  const result = await runTx<unknown>(db, 'readonly', (store) => store.get(IDB_KEY));
  db.close();
  return result;
}

function runTx<T>(
  db: IDBDatabase, mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = op(tx.objectStore(IDB_STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb tx failed'));
  });
}

// ─── base64 url-safe (no padding) ──────────────────────────────────────

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// b64decode —— explicitly returns Uint8Array<ArrayBuffer> instead of the
// default Uint8Array<ArrayBufferLike>; otherwise Web Crypto's BufferSource
// in lib.dom rejects it (it rejects SharedArrayBuffer-backed views).
function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
