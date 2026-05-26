// byoai-vault.ts —— browser-only encrypted store for the visitor's BYOAI cred.
//
// XSS-resistant 设计：
//   - 一把 non-extractable AES-256-GCM CryptoKey 存 IndexedDB (db: "standmeet-byoai",
//     store: "wrap", key: "v1")。CryptoKey object 在 JS 里看不到 raw bytes —
//     即使 XSS 拿到 indexedDB handle，也只能调 encrypt/decrypt，导不出 key
//     再外发到 attacker server。
//   - BYOAI api key 明文先用这个 CryptoKey AES-GCM 加密成 {iv, ct}，序列化
//     成 JSON 后放 localStorage key `standmeet:byoai:v2` 一坨（meta: provider /
//     endpoint / model 跟密文同行，方便 chat 走 SSE 时一次性拿全）。localStorage
//     单独被 dump 也没用（缺 CryptoKey），IndexedDB 单独被读也没用（缺 ciphertext）。
//
// v1 → v2 升级：v1 只存 {provider, iv, ct}，多 provider + endpoint/model 必须
// 重谈。v1 没 prod 用户，直接清掉，不做 migration。
//
// 用法：
//   await storeBYOAI({provider, endpoint, model, key});  // 进 vault
//   readBYOAIVaultMeta() === {provider, endpoint, model} // 同步 UI 元信息
//   await readBYOAIKey() === 'sk-…'                       // 解密明文 key
//   await readBYOAICredFull() === {...meta, key}          // chat 一次性拿全
//   await clearBYOAI()                                    // 登出 / 切 tier 时清
//
// 只支持现代浏览器；不做 crypto.subtle 缺失 fallback。

const LS_KEY = 'standmeet:byoai:v2';
const LS_KEY_LEGACY_V1 = 'standmeet:byoai:v1';
const IDB_NAME = 'standmeet-byoai';
const IDB_STORE = 'wrap';
const IDB_KEY = 'v1';
const IV_LEN = 12;

// BYOAIVaultMeta —— vault 里 non-secret 部分：UI 渲染、chat header 全用得着，
// 没必要 await decrypt。endpoint / model 跟 provider 同时落 / 同时清。
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

// storeBYOAI —— 第一次 / 覆盖写入 vault。若 IndexedDB 里还没 wrap key，
// 现场 generate 一个 non-extractable 的塞进去；然后用它 encrypt plaintext。
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

// readBYOAIVaultMeta —— sync；UI / chat header 读 provider+endpoint+model
// 用。明文 key 不在这里返。
export function readBYOAIVaultMeta(): BYOAIVaultMeta | null {
  const env = readEnvelope();
  return env ? { provider: env.provider, endpoint: env.endpoint, model: env.model } : null;
}

// hasBYOAI —— sync；vault 里是否已经有有效条目。
export function hasBYOAI(): boolean {
  return readEnvelope() !== null;
}

// readBYOAIKey —— async；解开 envelope 拿明文 api key。vault 空 / IDB 没 wrap
// key / decrypt 失败统一返 null（caller 视为"没配过 BYOAI"，让 UI 引去 /gate）。
export async function readBYOAIKey(): Promise<string | null> {
  const env = readEnvelope();
  return env ? await decryptEnvelope(env) : null;
}

// readBYOAICredFull —— async；chat 发请求前一次拿齐 4 个 header 所需字段
// （provider + endpoint + model + 明文 key）。任一不全返 null，外层走"未配
// BYOAI" 路径。
export async function readBYOAICredFull(): Promise<BYOAICredFull | null> {
  const env = readEnvelope();
  if (!env) return null;
  const key = await decryptEnvelope(env);
  if (key === null) return null;
  return {
    provider: env.provider, endpoint: env.endpoint, model: env.model, key,
  };
}

// clearBYOAI —— 清掉 localStorage envelope (v1+v2) + IDB wrap key。两层都要
// 清，否则下次 storeBYOAI 会复用残留的 wrap key，旧 envelope 还能解。
export async function clearBYOAI(): Promise<void> {
  window.localStorage.removeItem(LS_KEY);
  window.localStorage.removeItem(LS_KEY_LEGACY_V1);
  await idbDelete();
}

function readEnvelope(): StoredEnvelope | null {
  if (typeof window === 'undefined') return null;
  // 顺手清掉 legacy v1 残留（不做 migration —— v1 没 endpoint/model 缺字段）。
  if (window.localStorage.getItem(LS_KEY_LEGACY_V1) !== null) {
    window.localStorage.removeItem(LS_KEY_LEGACY_V1);
  }
  const raw = window.localStorage.getItem(LS_KEY);
  return raw ? parseEnvelope(raw) : null;
}

function parseEnvelope(raw: string): StoredEnvelope | null {
  try {
    const v = JSON.parse(raw) as Partial<StoredEnvelope>;
    return isEnvelope(v) ? v : null;
  } catch {
    return null;
  }
}

function isEnvelope(v: Partial<StoredEnvelope>): v is StoredEnvelope {
  return typeof v.provider === 'string' && v.provider !== ''
    && typeof v.endpoint === 'string'
    && typeof v.model === 'string'
    && typeof v.iv === 'string' && typeof v.ct === 'string';
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
// 用 Promise wrapper 把 IDBRequest 的 onsuccess/onerror 转 awaitable。

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

async function idbDelete(): Promise<void> {
  const db = await openDB();
  await runTx(db, 'readwrite', (store) => store.delete(IDB_KEY));
  db.close();
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

// b64decode —— 显式返 Uint8Array<ArrayBuffer> 而不是默认的
// Uint8Array<ArrayBufferLike>，否则 lib.dom 里 Web Crypto BufferSource
// 不接受（拒掉 SharedArrayBuffer-backed view）。
function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
