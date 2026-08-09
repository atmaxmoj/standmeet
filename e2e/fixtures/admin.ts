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

// postClaimWithRetry —— claim 有两种可重试的失败,而它们**长得完全不一样**:
//
//   401 —— setup_token 被 unclaim 轮换的竞态,是一个**状态码**;
//   超时 —— backend 刚被 dev-up recreate,冷启动还没听端口,`request.post` **直接抛**。
//
// 原来这个循环只看状态码,于是第二种失败连循环体都走不完就窜出去了:重试对真正会发生的
// 那种失败是瞎的。在负载高的机器上 backend 冷启动超过 10 秒是常态,不是异常。
//
// 两种都重试;最后一次仍失败 → 照抛(把原因带出去,别吞成一句笼统的 "claim failed")。
async function postClaimWithRetry(
  request: APIRequestContext, setupToken: string, body: ClaimBody,
): Promise<void> {
  let token = setupToken;
  for (let attempt = 0; attempt < CLAIM_RETRIES; attempt++) {
    const last = attempt === CLAIM_RETRIES - 1;
    const status = await claimStatus(request, token, body, last);
    if (status === 200) return;
    if (status !== 401 && status !== 0) {
      throw new Error(`claim failed: ${status}`);
    }
    if (last) {
      throw new Error(`claim failed after ${CLAIM_RETRIES} attempts: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_DELAY_MS));
    token = findSetupToken();
  }
}

// claimStatus —— 发一次 claim,回状态码。传输层抛错(超时/连接被拒)回 **0**,让调用方
// 跟 401 一样当作可重试;最后一次则原样抛,保住真正的错因。
//
// 超时**不代表服务端没做**:请求可能已经落库,只是回包慢。这时盲目重试会撞上
// 「token 已消费」(401)或「email 已占用」(409),最后抛一句跟真相相反的错。所以超时之后
// 先**问一次结果**——能用这套凭据登录就说明 claim 成立,直接当 200。
async function claimStatus(
  request: APIRequestContext, token: string, body: ClaimBody, rethrow: boolean,
): Promise<number> {
  try {
    const res = await request.post(`${BACKEND}/api/admin/claim`, {
      data: { token, ...body },
    });
    return res.status();
  } catch (err) {
    if (await claimLanded(request, body)) return 200;
    if (rethrow) throw err;
    return 0;
  }
}

// claimLanded —— 超时之后核对 claim 到底成没成:拿同一套邮箱/口令登录得上 = 成了。
async function claimLanded(request: APIRequestContext, body: ClaimBody): Promise<boolean> {
  const res = await request.post(`${BACKEND}/api/admin/login`, {
    data: { email: body.email, password: body.password },
  }).catch(() => null);
  return res?.status() === 200;
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

// clearAIProviderKey —— 把 owner 默认 provider 的 key 清掉,于是这台实例**答不了任何访客**。
// `claim` 总会种一条可用的 provider(上面 seedDevAIProvider),所以"没有可用 provider"这个状态
// 只能开出来 —— 而它正是 F-A-24 里 prod 升级之后落到的那个状态。
export async function clearAIProviderKey(
  request: APIRequestContext,
  creds: { email: string; password: string },
): Promise<void> {
  const { csrf } = await login(request, creds.email, creds.password);
  const res = await request.patch(`${BACKEND}/api/admin/ai-provider`, {
    headers: { 'X-Csrftoken': csrf },
    // endpoint + model 是必填的(这条 op 说的是"把默认那条整个提交一遍"),
    // 要清的只是 key,所以其余字段照原样送回去。
    data: {
      provider: 'anthropic',
      endpoint: process.env['LLM_GATEWAY_BACKEND_URL'] ?? 'http://llm-gateway:9300',
      model: 'claude-haiku-4-5-20251001',
      key_change: 'clear',
    },
  });
  if (res.status() !== 200) {
    throw new Error(`clear-ai-provider failed: ${res.status()} ${await res.text()}`);
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
