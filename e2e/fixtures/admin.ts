// admin.ts —— claim / login / API-token creation helpers (shared across specs).
//
// These are all "test preconditions", not the path under test itself; keeping
// them in a helper keeps the specs short.

import type { APIRequestContext, Page } from '@playwright/test';

import { findSetupToken } from '@/fixtures/instance';

const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
const DEFAULT_PASSWORD = 'correct-horse-battery-staple';
// resetInstance()'s unclaim rotates setup_token; occasionally findSetupToken
// reads a stale token → claim 401 ("invalid or already consumed"). This is a
// beforeAll race; retry by re-fetching the token only on the 401 path — the
// 200 happy path is left completely untouched.
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

// postClaimWithRetry —— claim has two retryable failures, and they **look
// completely different**:
//
//   401 —— the race where setup_token was rotated by unclaim; it's a **status code**;
//   timeout —— backend was just recreated by dev-up, cold-starting and not yet
//     listening on the port, so `request.post` **throws directly**.
//
// The loop originally only looked at the status code, so the second kind of
// failure escaped before the loop body even completed: the retry was blind to
// the failure that actually happens. On a loaded machine a backend cold-start
// over 10 seconds is the norm, not the exception.
//
// Retry both; if the last attempt still fails → rethrow (carry the reason out,
// don't swallow it into a vague "claim failed").
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

// claimStatus —— send one claim, return the status code. A transport-layer throw
// (timeout / connection refused) returns **0** so the caller treats it as
// retryable just like a 401; on the last attempt it rethrows as-is, preserving
// the real cause.
//
// A timeout **doesn't mean the server did nothing**: the request may already
// have hit the DB, just with a slow response. Blindly retrying here would run
// into "token already consumed" (401) or "email already taken" (409), and end
// up throwing something that contradicts the truth. So after a timeout, **ask
// for the result once** — if these credentials can log in, the claim landed;
// treat it as 200.
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

// DUMMY_CAPTCHA_TOKEN —— Cloudflare's test sitekey issues exactly this token
// (`XXXX.DUMMY.TOKEN.XXXX`), and the matching test secret accepts it. `make
// test-captcha` brings up the stack using exactly that key pair.
//
// Why carry it on every login: once captcha is on, `LoginGuard` requires an
// `X-Captcha-Token` on **every** owner login (not just after a lockout). When
// captcha is off nobody reads this header, so always sending it is safe —
// whereas missing it once turns a whole batch of specs red at the fixture,
// looking like the product broke ([[red-in-the-wrong-place]]).
const DUMMY_CAPTCHA_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

// loginRequest —— one request shape shared by the three login sites. They used
// to each write their own, so turning captcha on meant changing three places,
// and the one you missed would turn red on someone else.
function loginRequest(email: string, password: string) {
  return {
    data: { email, password },
    headers: { 'X-Captcha-Token': DUMMY_CAPTCHA_TOKEN },
  };
}

// claimLanded —— after a timeout, verify whether the claim actually landed:
// if the same email/password can log in, it landed.
async function claimLanded(request: APIRequestContext, body: ClaimBody): Promise<boolean> {
  const res = await request.post(
    `${BACKEND}/api/admin/login`, loginRequest(body.email, body.password),
  ).catch(() => null);
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
  const loginRes = await request.post(
    `${BACKEND}/api/admin/login`, loginRequest(creds.email, creds.password),
  );
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

// clearAIProviderKey —— clear the key on the owner's default provider, so this
// instance **can't answer any visitor**. `claim` always seeds a working provider
// (seedDevAIProvider above), so the "no usable provider" state can only be
// created by hand — and it's exactly the state F-A-24 lands in after a prod upgrade.
export async function clearAIProviderKey(
  request: APIRequestContext,
  creds: { email: string; password: string },
): Promise<void> {
  const { csrf } = await login(request, creds.email, creds.password);
  const res = await request.patch(`${BACKEND}/api/admin/ai-provider`, {
    headers: { 'X-Csrftoken': csrf },
    // endpoint + model are required (this op means "resubmit the whole default
    // provider row"); only the key is being cleared, so send the rest back as-is.
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
  const res = await request.post(`${BACKEND}/api/admin/login`, loginRequest(email, password));
  if (res.status() !== 200) throw new Error(`login failed: ${res.status()}`);
  const body = await res.json() as { csrf_token?: string };
  return { csrf: body.csrf_token ?? '' };
}

// createAPIToken —— after Phase C the old PAT path was removed, so this fixture
// now generates an Ed25519 keypair via /api/admin/keypairs and returns
// {keyId, privateKeyPem} JSON-encoded as a "creds blob". initMCP receives that
// blob → decodes + Sigv1-signs.
//
// The function name stays createAPIToken so the 78 existing specs don't change;
// the returned string is no longer a plaintext bearer, it's JSON. Specs pass it
// straight through to initMCP as an opaque blob.
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

// navigateToOwnerLogin —— take the page to /login (owner types /admin → auto
// redirect). Used by the owner-login spec to test that a wrong password stays on /login.
export async function navigateToOwnerLogin(page: Page): Promise<void> {
  await page.goto('/admin');
  await page.waitForURL('**/login', { timeout: 10_000 });
}

// navigateToSetup —— open the first-run /setup surface (no token → MissingToken
// view, but the AuthShell chrome incl. the offers panel still renders).
export async function navigateToSetup(page: Page): Promise<void> {
  await page.goto('/setup');
}
