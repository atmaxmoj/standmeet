// c1-keypair-auth.spec.ts -- Phase C-1: MCP Sigv1 auth + admin keypair CRUD.
//
// The old Bearer PAT path is deleted entirely (the api_tokens table is dead).
// The owner's only MCP auth method now: generate an Ed25519 keypair in admin
// -> get the PEM once -> every MCP request carries
// Authorization: Sigv1 keyId=X,ts=N,sig=base64
//
// Backend authContextFunc parses Sigv1:
//   - parse the header for keyId / ts / sig
//   - ts must fall within a +-5min window (anti-replay)
//   - look up owner_keypairs by keyId in the DB to get the public key
//   - ed25519.Verify(pub, "standmeet-sigv1\n<keyId>\n<ts>", sig)
//   - pass -> ownerID goes into ctx
//
// Coverage:
//   1. Happy path: generate -> sign -> MCP me call succeeds
//   2. Admin CRUD: list / hard-delete
//   3. Error cases: unknown keyId / bad sig / ts outside the window / revoked
//      keyId / legacy Bearer header

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createKeypair, deleteKeypair, listKeypairs } from '@/fixtures/keypair';
import { formatAuthHeader, signChallenge, signNow } from '@/fixtures/sigv1';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'c1@example.com', password: 'correct-horse-battery-staple',
  handle: 'c1', fullName: 'C-One Owner',
};

interface MCPResponse {
  jsonrpc: string;
  id?: number | string;
  result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  error?: { code: number; message: string };
}

test.beforeAll(async ({ playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
});

test.describe('Phase C-1 MCP Sigv1 keypair auth (happy + admin CRUD)', () => {

  test('happy: generate keypair → sign challenge → MCP me returns owner',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'c1-laptop');
      expect(kp.key_id.length).toBeGreaterThan(0);
      expect(kp.private_key_pem).toContain('BEGIN PRIVATE KEY');

      const sid = await mcpInit(request, kp.key_id, kp.private_key_pem);
      const me = await mcpCallMe(request, kp.key_id, kp.private_key_pem, sid);
      expect(me.email).toBe(OWNER.email);
      expect(me.handle).toBe(OWNER.handle);
      await request.dispose();
    });

  test('admin list returns metadata only (no PEM, no hash)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'list-spec');
      const list = await listKeypairs(request, csrf);
      const item = list.find((k) => k.key_id === kp.key_id);
      expect(item).toBeDefined();
      expect(item?.label).toBe('list-spec');
      // metadata only -- the list response must not contain the PEM
      const raw = JSON.stringify(list);
      expect(raw).not.toContain('BEGIN PRIVATE KEY');
      expect(raw).not.toContain('private_key');
      await request.dispose();
    });

  test('delete (revoke) → keyId immediately rejected on MCP',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'will-revoke');
      // verify works first
      await mcpInit(request, kp.key_id, kp.private_key_pem);
      // revoke
      await deleteKeypair(request, csrf, kp.key_id);
      // next MCP attempt with same keyId → unauthorized
      const res = await mcpInitRaw(request, kp.key_id, kp.private_key_pem);
      expect(res.status).toBeGreaterThanOrEqual(400);
      await request.dispose();
    });

  test('replay of the same nonce is rejected (one-time nonce)',
    async ({ playwright }) => {
      // One-time nonce: replaying the same {keyId,ts,nonce,sig} header within
      // the window -> nonce already seen -> rejected.
      // Deeper replay/freshness coverage lives in security-sigv1-replay.spec.ts.
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'replay-spec');
      const auth = formatAuthHeader(signNow(kp.private_key_pem, kp.key_id));
      const first = await rawMCPInitWithAuth(request, auth);
      const second = await rawMCPInitWithAuth(request, auth);
      expect(first.status).toBe(200);
      expect(second.status).not.toBe(200);
      await request.dispose();
    });
});

test.describe('Phase C-1 MCP Sigv1 keypair auth (reject paths)', () => {
  test('reject: unknown keyId', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const fakeID = '00000000-0000-0000-0000-000000000000';
    // sign with a randomly generated key so the sig itself is wellformed
    const fakePem = await generateRandomEd25519Pem();
    const res = await mcpInitRaw(request, fakeID, fakePem);
    expect(res.status).toBeGreaterThanOrEqual(400);
    await request.dispose();
  });

  test('reject: bad signature', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const kp = await createKeypair(request, csrf, 'bad-sig');
    // sign with a different key but claim the real keyId
    const otherPem = await generateRandomEd25519Pem();
    const signed = signNow(otherPem, kp.key_id);
    const res = await rawMCPInitWithAuth(request, formatAuthHeader(signed));
    expect(res.status).toBeGreaterThanOrEqual(400);
    await request.dispose();
  });

  test('reject: ts too far in the past', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const kp = await createKeypair(request, csrf, 'old-ts');
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 min past
    const signed = signChallenge(kp.private_key_pem, kp.key_id, oldTs);
    const res = await rawMCPInitWithAuth(request, formatAuthHeader(signed));
    expect(res.status).toBeGreaterThanOrEqual(400);
    await request.dispose();
  });

  test('reject: legacy Bearer token header path is gone',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      // Even a wellformed-looking pat string should be rejected outright.
      const res = await rawMCPInitWithAuth(
        request, 'Bearer st_anyrandomthing_definitelynotvalid',
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      await request.dispose();
    });

  test('reject: ts too far in the future (clock skew)', async ({ playwright }) => {
    const request = await playwright.request.newContext();
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const kp = await createKeypair(request, csrf, 'future-ts');
    const futureTs = Math.floor(Date.now() / 1000) + 600; // 10 min ahead
    const signed = signChallenge(kp.private_key_pem, kp.key_id, futureTs);
    const res = await rawMCPInitWithAuth(request, formatAuthHeader(signed));
    expect(res.status).toBeGreaterThanOrEqual(400);
    await request.dispose();
  });

  test('reject: malformed Authorization header (missing fields)',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const cases = [
        '',
        'Sigv1',
        'Sigv1 keyId=abc',
        'Sigv1 ts=123,sig=xx',
        'Sigv1 keyId=abc,sig=xx',
        'Bearer',
        'Random nonsense',
      ];
      for (const h of cases) {
        const res = await rawMCPInitWithAuth(request, h);
        expect(res.status, `header=${h}`).toBeGreaterThanOrEqual(400);
      }
      await request.dispose();
    });

});

test.describe('Phase C-1 MCP Sigv1 keypair auth (multi-key + hard delete)', () => {
  test('multi-key: owner can hold N keypairs, each resolves to same owner',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp1 = await createKeypair(request, csrf, 'two-keys-1');
      const kp2 = await createKeypair(request, csrf, 'two-keys-2');
      expect(kp1.key_id).not.toBe(kp2.key_id);
      const sid1 = await mcpInit(request, kp1.key_id, kp1.private_key_pem);
      const me1 = await mcpCallMe(request, kp1.key_id, kp1.private_key_pem, sid1);
      const sid2 = await mcpInit(request, kp2.key_id, kp2.private_key_pem);
      const me2 = await mcpCallMe(request, kp2.key_id, kp2.private_key_pem, sid2);
      expect(me1.email).toBe(OWNER.email);
      expect(me2.email).toBe(OWNER.email);
      await request.dispose();
    });

  test('delete is hard delete: list does not contain revoked key',
    async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
      const kp = await createKeypair(request, csrf, 'hard-delete-spec');
      const before = await listKeypairs(request, csrf);
      expect(before.find((k) => k.key_id === kp.key_id)).toBeDefined();
      await deleteKeypair(request, csrf, kp.key_id);
      const after = await listKeypairs(request, csrf);
      expect(after.find((k) => k.key_id === kp.key_id),
        'hard delete = gone from list').toBeUndefined();
      await request.dispose();
    });
});

// ─── MCP HTTP helpers (Sigv1-signed) ─────────────────────────────

async function mcpInit(
  request: APIRequestContext, keyID: string, pem: string,
): Promise<string> {
  const initRes = await mcpInitRaw(request, keyID, pem);
  if (initRes.status !== 200) {
    throw new Error(`mcp init: ${initRes.status} ${initRes.text}`);
  }
  if (!initRes.sessionId) throw new Error('mcp init missing session id');
  // notifications/initialized -- re-sign because each request is independent.
  await rawMCPCall(request, formatAuthHeader(signNow(pem, keyID)),
    { jsonrpc: '2.0', method: 'notifications/initialized' }, initRes.sessionId);
  return initRes.sessionId;
}

interface MCPCallResult { status: number; sessionId: string | null; body: MCPResponse | null; text: string }

async function mcpInitRaw(
  request: APIRequestContext, keyID: string, pem: string,
): Promise<MCPCallResult> {
  return await rawMCPInitWithAuth(request, formatAuthHeader(signNow(pem, keyID)));
}

async function rawMCPInitWithAuth(
  request: APIRequestContext, authHeader: string,
): Promise<MCPCallResult> {
  return await rawMCPCall(request, authHeader, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'c1-spec', version: '1' },
    },
  }, undefined);
}

async function rawMCPCall(
  request: APIRequestContext, authHeader: string,
  body: unknown, sessionId: string | undefined,
): Promise<MCPCallResult> {
  const headers: Record<string, string> = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await request.post(`${BACKEND}/mcp`, { headers, data: body });
  const text = await res.text();
  return {
    status: res.status(),
    sessionId: res.headers()['mcp-session-id'] ?? null,
    body: parseMCPText(text),
    text,
  };
}

function parseMCPText(text: string): MCPResponse | null {
  if (text.trim().startsWith('{')) return JSON.parse(text) as MCPResponse;
  if (text.includes('data:')) {
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (dataLine) return JSON.parse(dataLine.slice(5).trim()) as MCPResponse;
  }
  return null;
}

// mcpCallMe -- returns the **owner block** from the `me` payload.
//
// The payload is {owner:{...}, settings:{...}} -- once both facades share one
// payload shape, MCP no longer has its own flat version. This helper used to
// parse it as flat, so email/handle were always undefined, and the failure
// message only said "expected alice@example.com, received undefined" with no
// hint that the shape had changed.
async function mcpCallMe(
  request: APIRequestContext, keyID: string, pem: string, sid: string,
): Promise<{ email: string; handle: string; full_name: string }> {
  const res = await rawMCPCall(request, formatAuthHeader(signNow(pem, keyID)), {
    jsonrpc: '2.0', id: 99, method: 'tools/call',
    params: { name: 'me', arguments: {} },
  }, sid);
  if (res.status !== 200 || !res.body) {
    throw new Error(`me call status=${res.status} text=${res.text.slice(0, 200)}`);
  }
  if (res.body.result?.isError) {
    throw new Error(`me call error: ${res.body.result.content?.[0]?.text ?? ''}`);
  }
  const content = res.body.result?.content?.[0];
  if (content?.type !== 'text' || !content.text) {
    throw new Error('me call: no text content');
  }
  const payload = JSON.parse(content.text) as {
    owner?: { email: string; handle: string; full_name: string };
  };
  if (!payload.owner) {
    throw new Error(`me call: payload has no owner block: ${content.text.slice(0, 200)}`);
  }
  return payload.owner;
}

async function generateRandomEd25519Pem(): Promise<string> {
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
}
