// embed-token-auth.spec.ts —— the embed credential is a per-embed signed JWT, never the code.
//
// Design: wiki/.../key-designs/embed-credential-never-carries-the-code (2026-09-01).
//
// A <standmeet-chat> widget runs on a third-party site. Its session must land on an access code
// (the code carries role → corpus + capabilities), but the code is a reusable secret also printed
// on résumé QRs and emailed — writing it in the widget's public JS exposes it. Instead the embed
// carries a per-embed Ed25519 key; each session issue signs a short-lived JWT folding in a bound
// origin + expiry + one-time jti; the server verifies with the embed's public key and resolves it
// to the code_id SERVER-SIDE. The plaintext code never leaves the server.
//
// Criteria (pairs, positive control first — [[guard-must-fail-on-the-bug]]):
//   · a valid token from an allowed origin issues a session that resolved to the embed's code,
//     and the request never carried the plaintext code;
//   · every forgery lever is refused: replay (jti), origin claim≠header, origin off allowlist,
//     expired, wrong key, alg-confusion (alg:"none"), and a revoked embed.
// RED before implementation: /api/v1/sessions doesn't accept embed_token and admin embed create
// returns no key → the positive test can't even build a token.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';
import { signEmbedToken } from '@/fixtures/embed-token';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'embedtoken@example.com', password: 'correct-horse-battery-staple',
  handle: 'embedtoken', fullName: 'Embed Token Owner',
};

const ALLOWED = 'https://partner.example';
const EVIL = 'https://evil.example';
const CODE = 'EMBED-TOKEN';

interface EmbedWithKey {
  id: string;
  key_id: string;
  private_key: string;
}

// createEmbedWithKey —— create an embed; the server mints a per-embed Ed25519 keypair and returns
// the private key ONCE (like owner keypairs). allowed_origins pins the host.
async function createEmbedWithKey(
  request: APIRequestContext, csrf: string, codeID: string, origins: string[],
): Promise<EmbedWithKey> {
  const res = await request.post(`${BACKEND}/api/admin/embeds`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code_id: codeID, label: 'partner', allowed_origins: origins },
  });
  if (res.status() !== 201) throw new Error(`create embed failed: ${res.status()}`);
  const body = await res.json() as Partial<EmbedWithKey>;
  if (!body.key_id || !body.private_key) {
    throw new Error('embed create did not return a per-embed key');
  }
  return { id: body.id ?? '', key_id: body.key_id, private_key: body.private_key };
}

// issueWithToken —— POST /api/v1/sessions carrying an embed_token (NOT a code) + the Origin header
// the browser would send. Returns {status, body}.
async function issueWithToken(
  request: APIRequestContext, token: string, origin: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: { mode: 'code', embed_token: token, visitor_name: 'Widget Wanda' },
  });
  const body = res.status() === 200 ? await res.json() as Record<string, unknown> : {};
  return { status: res.status(), body };
}

interface EmbedSetup {
  request: APIRequestContext;
  csrf: string;
  embed: EmbedWithKey;
  otherEmbed: EmbedWithKey;
}

// setupEmbeds —— 一次性建两把 embed：主 embed（本 code）+ 另一把（另一个 code，用来签"错密钥"的 token）。
// 抽出 describe 之外，让 describe 回调保持在行数上限内。
async function setupEmbeds(
  playwright: { request: { newContext: () => Promise<APIRequestContext> } },
): Promise<EmbedSetup> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
  const role = await createRole(request, csrf, {
    name: 'embed-role', description: 'wiki://**', corpus_uris: ['wiki://**'],
  });
  const code = await createCode(request, csrf, {
    code: CODE, label: 'partner widget', assumed_role_id: role.id,
  });
  const embed = await createEmbedWithKey(request, csrf, code.id, [ALLOWED]);
  const code2 = await createCode(request, csrf, {
    code: 'EMBED-TOKEN-2', label: 'other', assumed_role_id: role.id,
  });
  const otherEmbed = await createEmbedWithKey(request, csrf, code2.id, [ALLOWED]);
  return { request, csrf, embed, otherEmbed };
}

test.describe('embed · the credential is a per-embed signed JWT, never the code', () => {
  let request: APIRequestContext;
  let csrf = '';
  let embed: EmbedWithKey;
  let otherEmbed: EmbedWithKey;

  test.beforeAll(async ({ playwright }) => {
    ({ request, csrf, embed, otherEmbed } = await setupEmbeds(playwright));
  });
  test.afterAll(async () => { await request.dispose(); });

  const tokenFor = (e: EmbedWithKey, origin = ALLOWED, over = {}): string =>
    signEmbedToken({ keyId: e.key_id, embedId: e.id, origin, privateKeyPem: e.private_key, ...over });

  // ── positive control ─────────────────────────────────────────────
  test('a valid token from the allowed origin issues a session resolved to the embed\'s code',
    async () => {
      const token = tokenFor(embed);
      const { status, body } = await issueWithToken(request, token, ALLOWED);
      expect(status, 'a well-formed token from the allowed origin must issue a session').toBe(200);
      expect(body['session_token'], 'a session token comes back').toBeTruthy();
      // resolved to the code SERVER-SIDE: the response echoes the code the request never carried.
      expect(body['code'], 'the server resolved the embed to its code').toBe(CODE);
      // the request carried embed_token, not the plaintext code — the whole point.
      expect(token.includes(CODE), 'the JWT must not contain the plaintext code').toBe(false);
    });

  // ── every forgery lever refused ──────────────────────────────────
  test('a replayed token (same jti) is refused the second time', async () => {
    const token = tokenFor(embed, ALLOWED, { jti: 'fixed-jti-for-replay' });
    expect((await issueWithToken(request, token, ALLOWED)).status,
      'first use of the token is accepted').toBe(200);
    expect((await issueWithToken(request, token, ALLOWED)).status,
      'replaying the exact same token must be refused (one-time jti)').toBe(401);
  });

  test('a token whose origin claim differs from the browser Origin header is refused', async () => {
    // signed for ALLOWED, but delivered with an EVIL Origin header → mismatch.
    const token = tokenFor(embed, ALLOWED);
    expect((await issueWithToken(request, token, EVIL)).status).toBe(401);
  });

  test('a token for an origin outside the allowlist is refused', async () => {
    const token = tokenFor(embed, EVIL);
    expect((await issueWithToken(request, token, EVIL)).status,
      'origin not in the embed allowlist → 403').toBe(403);
  });

  test('an expired token is refused', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = tokenFor(embed, ALLOWED, { iat: past, exp: past + 60 });
    expect((await issueWithToken(request, token, ALLOWED)).status).toBe(401);
  });

  test('a token signed with a different embed\'s key is refused', async () => {
    // kid says `embed`, but signed with otherEmbed's private key → signature fails.
    const token = signEmbedToken({
      keyId: embed.key_id, embedId: embed.id, origin: ALLOWED,
      privateKeyPem: otherEmbed.private_key,
    });
    expect((await issueWithToken(request, token, ALLOWED)).status).toBe(401);
  });

  test('a token with alg:"none" is refused (server pins EdDSA)', async () => {
    const token = tokenFor(embed, ALLOWED, { alg: 'none' });
    expect((await issueWithToken(request, token, ALLOWED)).status).toBe(401);
  });

  test('after the embed is revoked, its tokens stop working', async () => {
    const token = tokenFor(embed, ALLOWED);
    await request.delete(`${BACKEND}/api/admin/embeds/${embed.id}`, {
      headers: { 'X-Csrftoken': csrf },
    });
    expect((await issueWithToken(request, token, ALLOWED)).status,
      'a revoked embed → its key_id no longer resolves → 401').toBe(401);
  });
});
