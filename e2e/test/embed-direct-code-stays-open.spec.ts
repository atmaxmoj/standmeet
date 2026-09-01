// embed-direct-code-stays-open.spec.ts —— embedding a code must NOT lock its direct use.
//
// 背景（2026-09-01，防盗上线后发现）：origin 白名单一度也 gate 了**明文 code 直连**那条路。
// 但防盗设计（[[embed-credential-never-carries-the-code]]）之后，code 明文**从不**出现在第三方
// 站点的 HTML 里——widget 走的是 embed_token（JWT）。所以明文 code 那条路只剩 owner 自己的用途：
// 扫 QR / 点分享链接落到实例页（同源）、直接粘码。这些都不该被 embed 的 partner 白名单挡住。
//
// 之前的行为：给一张码挂了 embed（白名单 partner.example），从实例自己的 origin 直连这张码 → 403。
// 于是 QR / 分享链接全断——把「加了个 widget」变成「这张码的直连全废」。这就是 gate 粒度过粗
// 拿掉了一个本来做得到的动作（[[gate-granularity-removes-working-action]]）。
//
// 正确模型：**白名单只 gate widget/token 那条路**（origin 折进 JWT、按白名单校，见
// embed-token-auth.spec.ts）。**明文 code 直连不受 origin 限制**——它跟没有 embed 时一模一样，
// 泄露了就 revoke。
//
// 判据（正对照）：一张**被 embed 暴露**的码，明文直连从**任何** origin 都成——含实例自己、
// 白名单外、没有 Origin 头。RED（修之前）：这些从非白名单 origin 直连拿到 403。

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

// directSession —— 明文 code 直连（不是 embed_token）。origin 可传空（不带 Origin 头）。
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
    // 给它挂一个钉了 partner 来源的 embed —— 这不该影响明文直连。
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

  // 一张码只能被一个 embed 暴露：来源白名单/密钥才有唯一确定的那一份。
  test('a code cannot be exposed by a second embed', async () => {
    expect(await createEmbed(request, csrf, embeddedCodeID, ['https://second.example']),
      '一张码已挂了 embed，再挂一个必须被拒（409）').toBe(409);
  });
});
