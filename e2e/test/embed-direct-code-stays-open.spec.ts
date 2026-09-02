// embed-direct-code-stays-open.spec.ts —— embedding a code must NOT lock its direct use.
//
// Background (2026-09-01, found after the anti-theft feature shipped): the origin
// allowlist had at one point also gated **plaintext code direct-use**. But after the
// anti-theft design ([[embed-credential-never-carries-the-code]]), the plaintext code
// **never** appears in a third-party site's HTML — the widget goes through embed_token
// (a JWT) instead. So the plaintext-code path only serves the owner's own uses: scanning
// a QR / clicking a share link that lands on the instance page (same-origin), or pasting
// the code directly. None of these should be blocked by the embed's partner allowlist.
//
// Previous behavior: attach an embed to a code (allowlisting partner.example), then
// direct-use that code from the instance's own origin -> 403. That broke every QR / share
// link — turning "we added a widget" into "direct use of this code is now dead
// everywhere". That's a gate whose granularity is too coarse, removing an action that
// used to work ([[gate-granularity-removes-working-action]]).
//
// The correct model: **the allowlist only gates the widget/token path** (origin is
// folded into the JWT and checked against the allowlist, see embed-token-auth.spec.ts).
// **Plaintext code direct-use is not restricted by origin at all** — it behaves exactly
// as if there were no embed; if it leaks, revoke it.
//
// Criterion (positive control): a code that **has been exposed via embed** must still
// allow plaintext direct-use from **any** origin — including the instance itself, origins
// outside the allowlist, and no Origin header at all. RED (before the fix): these
// direct-uses from non-allowlisted origins got a 403.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import { createCode } from '@/fixtures/codes';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

const OWNER = {
  email: 'embeddirect@example.com', password: 'correct-horse-battery-staple',
  handle: 'embeddirect', fullName: 'Embed Direct Owner',
};

const ALLOWED = 'https://partner.example';
const INSTANCE = 'http://localhost:38127'; // QR / share links land here (same-origin as the instance)
const ELSEWHERE = 'https://somewhere-else.example';
const EMBEDDED_CODE = 'EMBED-DIRECT';

async function createEmbed(
  request: APIRequestContext, csrf: string, codeID: string, origins: string[],
): Promise<number> {
  const res = await request.post(`${BACKEND}/api/admin/embeds`, {
    headers: { 'X-Csrftoken': csrf },
    data: { code_id: codeID, label: 'e', allowed_origins: origins },
  });
  return res.status();
}

// directSession — plaintext code direct-use (not embed_token). origin may be null (no
// Origin header sent).
async function directSession(
  request: APIRequestContext, code: string, origin: string | null,
): Promise<number> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin !== null) headers['Origin'] = origin;
  const res = await request.post(`${BACKEND}/api/v1/sessions`, {
    headers, data: { mode: 'code', code, visitor_name: 'Direct Dan' },
  });
  return res.status();
}

test.describe('embed · embedding a code leaves its direct (plaintext) use open everywhere', () => {
  let request: APIRequestContext;
  let csrf = '';
  let embeddedCodeID = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    csrf = (await loginAPI(request, OWNER.email, OWNER.password)).csrf;
    const role = await createRole(request, csrf, {
      name: 'embed-role', description: 'wiki://**', corpus_uris: ['wiki://**'],
    });
    const code = await createCode(request, csrf, {
      code: EMBEDDED_CODE, label: 'embedded', assumed_role_id: role.id,
    });
    embeddedCodeID = code.id;
    // Attach an embed pinned to the partner origin — this should not affect plaintext
    // direct-use.
    expect(await createEmbed(request, csrf, code.id, [ALLOWED]), '建 embed 必须成功').toBe(201);
  });
  test.afterAll(async () => { await request.dispose(); });

  test('direct use works from the instance origin (where QR / share links land)', async () => {
    expect(await directSession(request, EMBEDDED_CODE, INSTANCE),
      '扫 QR / 点链接落到实例页，同源直连这张码必须成 —— 挂了 embed 也一样').toBe(200);
  });

  test('direct use works from an origin outside the embed allowlist', async () => {
    expect(await directSession(request, EMBEDDED_CODE, ELSEWHERE),
      '明文 code 直连不受 embed 白名单限制（白名单只管 widget/token 那条路）').toBe(200);
  });

  test('direct use works with no Origin header at all (native app / curl)', async () => {
    expect(await directSession(request, EMBEDDED_CODE, null),
      '没有 Origin 头（原生客户端）也该能直连').toBe(200);
  });

  // A code can only be exposed by one embed: only that way does the origin
  // allowlist/secret have a single, unambiguous owner.
  test('a code cannot be exposed by a second embed', async () => {
    expect(await createEmbed(request, csrf, embeddedCodeID, ['https://second.example']),
      '一张码已挂了 embed，再挂一个必须被拒（409）').toBe(409);
  });
});
