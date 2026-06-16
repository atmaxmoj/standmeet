// gcal-setup.ts —— shared spec setup for the gcal-booking suite.
// Composes claim → login → credentials → OAuth → policy + code into
// reusable starting states.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, login } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import {
  MOCK_GCAL_CREDS, disconnectGCal, getGCalStatus, initGCalOAuth,
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
  const request: APIRequestContext = await playwright.request.newContext();
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
  const visitor = await issueSession(seed.request, {
    handle: OWNER.handle, mode: 'code', code: code.code,
    visitor_name: 'Recruiter Rachel',
  });
  return { ...seed, code, visitor };
}

// ─── OAuth flow driver ─────────────────────────────────────────

async function runMockOAuthFlow(seed: BaseSeed): Promise<void> {
  // Backend issues an auth URL pointing at the mock; visiting it via
  // request context follows the 302 chain back to /callback, which the
  // backend handles + persists tokens.
  const { auth_url } = await initGCalOAuth(seed.request, seed.csrf);
  const res = await seed.request.get(auth_url);
  if (res.status() !== 200) {
    throw new Error(`oauth flow: final status ${res.status()}`);
  }
}

// ─── teardown ───────────────────────────────────────────────────

export async function teardownSeed(seed: BaseSeed): Promise<void> {
  await safeDisconnect(seed);
  await seed.request.dispose();
}

async function safeDisconnect(seed: BaseSeed): Promise<void> {
  try { await disconnectGCal(seed.request, seed.csrf); } catch { /* noop */ }
}
