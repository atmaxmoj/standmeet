// gcal-setup.ts —— shared spec setup for the gcal-booking suite.
// Composes claim → login → credentials → OAuth → policy + code into
// reusable starting states.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test } from '@/fixtures/test';

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
  // This setup has to reset the instance + claim + log in + store credentials +
  // run through the mock OAuth + create skill/role/code. Just after a stack
  // rebuild (cold image layers, first sandbox spawn) it exceeds the default 30s,
  // and what's reported then is **"beforeAll hook timeout"** —— a line unrelated
  // to the product that looks like this case failed. The budget is given at the
  // **seed layer** rather than written into each spec: the next spec that uses it
  // doesn't have to hit the same wall again ([[lesson-not-swept-to-neighbours]]).
  test.setTimeout(150_000);
  resetInstance();
  // beforeAll setup POSTs occasionally take >10s when running serially under load
  // (config actionTimeout=10_000); give the seed's request context a wide explicit
  // timeout so a precondition doesn't flake out the whole describe.
  const request: APIRequestContext = await playwright.request.newContext({ timeout: 30_000 });
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await login(request, OWNER.email, OWNER.password);
  await resetMockGCal(request);
  return { request, csrf };
}

/** Claim + login + paste credentials (NOT authorized).
 *
 *  `scopes` is what the owner ticked on the card. Omitted = everything the
 *  connector offers, which is what every spec but the read-only one wants. */
export async function seedOwnerCredentialed(
  playwright: Playwright, scopes?: readonly string[],
): Promise<BaseSeed> {
  const seed = await seedOwnerLoggedIn(playwright);
  await saveGCalCredentials(seed.request, seed.csrf, { ...MOCK_GCAL_CREDS, scopes });
  return seed;
}

/** Fully connected: credentials + OAuth complete. Backend defaults
 *  (24h lead, Mon-Fri, 09-18) apply unless caller passes overrides. */
export async function seedOwnerGCalConnected(
  playwright: Playwright, policy?: Partial<BookingPolicy>, scopes?: readonly string[],
): Promise<BaseSeed> {
  const seed = await seedOwnerCredentialed(playwright, scopes);
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
  // scopes —— the scopes the owner grants. Omitted = grant everything, which is
  // what the vast majority of specs want. Passing `[GCAL_SCOPE_READ]` gives an
  // instance that's **connected but can't write** (F-B-8).
  scopes?: readonly string[];
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
  }, input.scopes);
  const code = await issueCodeWithSkills(seed.request, seed.csrf, {
    granted_skills: input.granted_skills ?? ['calendar.book'],
    max_bookings: input.max_bookings,
  });
  // visitor_email goes into the session profile —— the booking invite's recipient
  // is hard-controlled through it (calendar_book no longer accepts a visitor_email
  // tool arg).
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
  // §9: connect only connects; to be resolved by booking it must also occupy the
  // calendar category slot.
  await activateGCal(seed.request, seed.csrf);
}

// oauthDanceWithRetry —— init + follow the 302 chain back to /callback. Under
// parallel load the backend's callback leg occasionally hits "socket hang up" (a
// momentary connection drop, a nondeterministic failure). Retry only these
// transient network errors, re-initing each time to get a **fresh state** (state
// is single-use, the old one can't be reused); deterministic errors (status≠200
// etc.) throw immediately, without masking a real failure.
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
  // beforeAll threw (setup POST timeout etc.) → seed was never assigned. Don't let
  // afterAll throw a "reading 'request' of undefined" that covers up the real
  // cause; with no seed, just return silently.
  if (seed === undefined) return;
  await safeDisconnect(seed);
  await seed.request.dispose();
}

async function safeDisconnect(seed: BaseSeed): Promise<void> {
  try { await disconnectGCal(seed.request, seed.csrf); } catch { /* noop */ }
}
