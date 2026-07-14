// admin.ts —— claim / login / API token 创建 helper（spec 共用）。
//
// 这些都属于"测试前置条件"，不是被测路径本身；放 helper 让 spec 短促。

import type { APIRequestContext, Page } from '@playwright/test';

import { findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DEFAULT_PASSWORD = 'correct-horse-battery-staple';
// resetInstance() 的 unclaim 会轮换 setup_token;偶发 findSetupToken 读到旧
// token → claim 401("invalid or already consumed")。这是个 beforeAll 竞态,
// 只在 401 路径重取 token 重试,200 happy path 完全不动。
const CLAIM_RETRIES = 3;
const CLAIM_RETRY_DELAY_MS = 300;

export interface ClaimOptions {
  email?: string;
  password?: string;
  handle?: string;
  fullName?: string;
  publicUrl?: string;
}

// Default public_url for specs: the app port (38127) since recruiters land
// on the Next.js app. QR URL builder uses this from owners.public_url at
// commit time. Override per spec if exercising a different public host.
const DEFAULT_PUBLIC_URL = 'http://localhost:38127';

export async function claim(
  request: APIRequestContext,
  setupToken: string,
  opts: ClaimOptions = {},
): Promise<void> {
  const email = opts.email ?? 'alice@example.com';
  const password = opts.password ?? DEFAULT_PASSWORD;
  const handle = opts.handle ?? 'alice';
  const fullName = opts.fullName ?? 'Alice Anderson';
  const publicUrl = opts.publicUrl ?? DEFAULT_PUBLIC_URL;
  await postClaimWithRetry(request, setupToken, {
    email, password, handle, full_name: fullName, public_url: publicUrl,
  });
  await seedDevAIProvider(request, { email, password });
}

interface ClaimBody {
  email: string; password: string; handle: string;
  full_name: string; public_url: string;
}

// postClaimWithRetry —— claim 偶发 401(setup_token 被 unclaim 轮换的竞态)。
// 401 时重取 token 重试;其它状态 / 重试用尽 → 抛。200 直接返回(happy path 不变)。
async function postClaimWithRetry(
  request: APIRequestContext, setupToken: string, body: ClaimBody,
): Promise<void> {
  let token = setupToken;
  for (let attempt = 0; attempt < CLAIM_RETRIES; attempt++) {
    const res = await request.post(`${BACKEND}/api/admin/claim`, {
      data: { token, ...body },
    });
    if (res.status() === 200) return;
    if (res.status() !== 401 || attempt === CLAIM_RETRIES - 1) {
      throw new Error(`claim failed: ${res.status()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_DELAY_MS));
    token = findSetupToken();
  }
}

// seedDevAIProvider —— in dev/e2e the backend's anthropic provider talks
// to mock-stack/llm-gateway. A real owner sets this via the admin UI once
// after claim; here we POST the same admin endpoint so the owner row is
// configured before any visitor-chat spec runs.
//
// Endpoint resolves to the gateway service from inside the docker network
// (backend container talks to llm-gateway:9300 by service name).
async function seedDevAIProvider(
  request: APIRequestContext,
  creds: { email: string; password: string },
): Promise<void> {
  const endpoint = process.env['LLM_GATEWAY_BACKEND_URL']
    ?? 'http://llm-gateway:9300';
  const loginRes = await request.post(`${BACKEND}/api/admin/login`, {
    data: { email: creds.email, password: creds.password },
  });
  if (loginRes.status() !== 200) {
    throw new Error(`seed-ai-provider login failed: ${loginRes.status()}`);
  }
  const { csrf_token: csrf } = await loginRes.json() as { csrf_token?: string };
  if (!csrf) throw new Error('seed-ai-provider: missing csrf');
  const res = await request.patch(`${BACKEND}/api/admin/ai-provider`, {
    headers: { 'X-Csrftoken': csrf },
    data: {
      provider: 'anthropic',
      endpoint,
      model: 'claude-haiku-4-5-20251001',
      key_change: 'set',
      key: 'dev-llm-gateway-dummy-key',
    },
  });
  if (res.status() !== 200) {
    throw new Error(`seed-ai-provider failed: ${res.status()} ${await res.text()}`);
  }
}

export interface AdminLogin {
  csrf: string;
}

export async function login(
  request: APIRequestContext,
  email = 'alice@example.com',
  password = DEFAULT_PASSWORD,
): Promise<AdminLogin> {
  const res = await request.post(`${BACKEND}/api/admin/login`, { data: { email, password } });
  if (res.status() !== 200) throw new Error(`login failed: ${res.status()}`);
  const body = await res.json() as { csrf_token?: string };
  return { csrf: body.csrf_token ?? '' };
}

// createAPIToken —— Phase C 之后老 PAT 路径已删，本 fixture 改成 generate
// Ed25519 keypair via /api/admin/keypairs 然后把 {keyId, privateKeyPem}
// JSON-encode 当 "creds blob" 返回。initMCP 接到该 blob → 解 + Sigv1 签。
//
// 函数名留 createAPIToken 让 78 个现有 spec 不动；返值的 string 不再是
// plaintext bearer，是 JSON。spec 都把它当 opaque blob 透传给 initMCP。
export async function createAPIToken(
  request: APIRequestContext,
  csrf: string,
  name = 'e2e-token',
): Promise<string> {
  const res = await request.post(`${BACKEND}/api/admin/keypairs`, {
    headers: { 'X-Csrftoken': csrf },
    data: { label: name },
  });
  if (res.status() !== 201) {
    throw new Error(`create keypair failed: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json() as { key_id?: string; private_key_pem?: string };
  if (!body.key_id || !body.private_key_pem) {
    throw new Error('create keypair: missing key_id / private_key_pem in response');
  }
  return JSON.stringify({ keyId: body.key_id, privateKeyPem: body.private_key_pem });
}

// navigateToOwnerLogin —— 把 page 带到 /login（owner 输 /admin → 自动 redirect）。
// 给 owner-login spec 测错密码停留在 /login 用。
export async function navigateToOwnerLogin(page: Page): Promise<void> {
  await page.goto('/admin');
  await page.waitForURL('**/login', { timeout: 10_000 });
}

// navigateToSetup —— open the first-run /setup surface (no token → MissingToken
// view, but the AuthShell chrome incl. the offers panel still renders).
export async function navigateToSetup(page: Page): Promise<void> {
  await page.goto('/setup');
}
