// gcal-setup.ts —— shared spec setup for the gcal-booking suite.
// Composes claim → login → credentials → OAuth → policy + code into
// reusable starting states.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  MOCK_GCAL_CREDS, activateGCal, disconnectGCal, getGCalStatus, initGCalOAuth,
  resetMockGCal, saveGCalCredentials, setBookingPolicy,
  type BookingPolicy,
} from '@/fixtures/gcal';
import {
  issueCodeWithSkills,
  type IssuedCode,
} from '@/fixtures/agent-skills-grant';
import { issueSession, type VisitorSession } from '@/fixtures/visitor';

export const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
} as const;

// ─── seeds, in order of completeness ───────────────────────────

export interface BaseSeed {
  request: APIRequestContext;
  csrf: string;
}

/** Just claim + login. Cleans GCal mock state too. */
export async function seedOwnerLoggedIn(playwright: Playwright): Promise<BaseSeed> {
  resetInstance();
  // beforeAll setup POSTs 在满载串行跑时偶发 >10s(config actionTimeout=10_000),
  // 给 seed 的 request context 一个宽的显式超时,别让前置条件 flake 掉整个 describe。
  const request: APIRequestContext = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  await resetMockGCal(request);
  return { request, csrf };
}

/** Claim + login + paste credentials (NOT authorized). */
export async function seedOwnerCredentialed(playwright: Playwright): Promise<BaseSeed> {
  const seed = await seedOwnerLoggedIn(playwright);
  await saveGCalCredentials(seed.request, seed.csrf, MOCK_GCAL_CREDS);
  return seed;
}

/** Fully connected: credentials + OAuth complete. Backend defaults
 *  (24h lead, Mon-Fri, 09-18) apply unless caller passes overrides. */
export async function seedOwnerGCalConnected(
  playwright: Playwright, policy?: Partial<BookingPolicy>,
): Promise<BaseSeed> {
  const seed = await seedOwnerCredentialed(playwright);
  await runMockOAuthFlow(seed);
  if (policy) await setBookingPolicy(seed.request, seed.csrf, policy);
  const status = await getGCalStatus(seed.request);
  if (!status.connected) throw new Error('seedOwnerGCalConnected: not connected');
  return seed;
}

/** Connected owner + code issued with `granted_skills` + optional quota. */
export interface CodedSeed extends BaseSeed {
  code: IssuedCode;
  visitor: VisitorSession;
}

export interface CodedSeedInput {
  granted_skills?: readonly string[];
  max_bookings?: number;
  policy?: Partial<BookingPolicy>;
}

export async function seedCodeVisitorOnConnectedOwner(
  playwright: Playwright, input: CodedSeedInput = {},
): Promise<CodedSeed> {
  // chat-book specs care about quotas/conflicts, not policy gating. Apply
  // a permissive policy (all weekdays, minimum 1-day lead) by default so
  // they don't have to guess what day "+N days from now" lands on. min_lead_days
  // is always >= 1 (positive-int contract); these specs book +7 days out so the
  // lead never bites.
  const permissive: Partial<BookingPolicy> = {
    allowed_weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    min_lead_days: 1,
  };
  const seed = await seedOwnerGCalConnected(playwright, {
    ...permissive, ...input.policy,
  });
  const code = await issueCodeWithSkills(seed.request, seed.csrf, {
    granted_skills: input.granted_skills ?? ['calendar.book'],
    max_bookings: input.max_bookings,
  });
  // visitor_email 进 session profile —— booking 的 invite 收件人硬控走它
  // (calendar_book 不再接受 visitor_email tool arg)。
  const visitor = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel', visitor_email: 'rachel@example.com',
  });
  return { ...seed, code, visitor };
}

/** Connect GCal on an owner that already exists — credentials + OAuth + activate,
 *  WITHOUT resetting the instance.
 *
 *  seedOwnerGCalConnected resets first, which is right for API-only specs but kills
 *  the admin browser session a GUI spec logged in with. A spec that drives the card
 *  needs to claim once in beforeAll and then change connector state underneath the
 *  same session. */
export async function connectGCalOnExistingOwner(seed: BaseSeed): Promise<void> {
  await saveGCalCredentials(seed.request, seed.csrf, MOCK_GCAL_CREDS);
  await runMockOAuthFlow(seed);
  const status = await getGCalStatus(seed.request);
  if (!status.connected) throw new Error('connectGCalOnExistingOwner: not connected');
}

// ─── OAuth flow driver ─────────────────────────────────────────

async function runMockOAuthFlow(seed: BaseSeed): Promise<void> {
  // Backend issues an auth URL pointing at the mock; visiting it via
  // request context follows the 302 chain back to /callback, which the
  // backend handles + persists tokens.
  await oauthDanceWithRetry(seed);
  // §9: connect 只是连上；要被 booking 解析到，还得占用 calendar 品类槽。
  await activateGCal(seed.request, seed.csrf);
}

// oauthDanceWithRetry —— init + 走 302 链回 /callback。并行负载下 backend 的 callback 腿偶发
// "socket hang up"（连接瞬断，非确定性失败）。只对这类瞬时网络错重试，每次重新 init 拿**新 state**
// （state 单次使用，不能复用旧的）；确定性错（status≠200 等）立即抛，不掩盖真失败。
async function oauthDanceWithRetry(seed: BaseSeed): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { auth_url } = await initGCalOAuth(seed.request, seed.csrf);
      const res = await seed.request.get(auth_url);
      if (res.status() !== 200) {
        throw new Error(`oauth flow: final status ${res.status()}`);
      }
      return;
    } catch (err) {
      lastErr = err;
      if (!isTransientNetErr(err)) throw err;
    }
  }
  throw lastErr;
}

function isTransientNetErr(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /socket hang up|ECONNRESET|ECONNREFUSED|socket disconnected/i.test(msg);
}

// ─── teardown ───────────────────────────────────────────────────

export async function teardownSeed(seed: BaseSeed | undefined): Promise<void> {
  // beforeAll 抛了(setup POST 超时等)→ seed 没赋值。别让 afterAll 再抛个
  // "reading 'request' of undefined" 把真因盖掉;没 seed 直接静默返回。
  if (seed === undefined) return;
  await safeDisconnect(seed);
  await seed.request.dispose();
}

async function safeDisconnect(seed: BaseSeed): Promise<void> {
  try { await disconnectGCal(seed.request, seed.csrf); } catch { /* noop */ }
}
